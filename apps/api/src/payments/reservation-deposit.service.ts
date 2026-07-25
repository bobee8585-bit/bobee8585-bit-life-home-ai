import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  PaymentTransactionStatus,
  PaymentTransactionType,
  Prisma,
  ReservationDepositStatus,
  ReservationRefundReason,
  VisitReservationStatus,
} from '../generated/prisma/client';
import {
  PaymentProviderException,
  PaymentProviderService,
  type PaymentProviderName,
} from './payment-provider.service';

const depositInclude = {
  transactions: { orderBy: { createdAt: 'asc' as const } },
} as const;

type DepositViewInput = Prisma.ReservationDepositGetPayload<{
  include: typeof depositInclude;
}>;

@Injectable()
export class ReservationDepositService {
  private readonly amount = this.depositAmount();
  private readonly currency = 'KRW';
  private readonly policyVersion =
    process.env.RESERVATION_REFUND_POLICY_VERSION ?? '2026-07-v2';
  private readonly userCancellationRefundRate = this.refundRate(
    process.env.RESERVATION_USER_CANCELLATION_REFUND_RATE,
    '1.00',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProviderService,
  ) {}

  async prepare(
    payerId: string,
    reservationId: string,
    idempotencyKey: string,
  ) {
    const key = this.idempotencyKey(idempotencyKey);
    const existingByKey = await this.prisma.reservationDeposit.findUnique({
      where: { prepareIdempotencyKey: key },
      include: depositInclude,
    });
    if (existingByKey) {
      if (
        existingByKey.payerId !== payerId ||
        existingByKey.reservationId !== reservationId
      ) {
        throw new ConflictException(
          '멱등성 키가 다른 결제 요청에 사용되었습니다.',
        );
      }
      return this.view(existingByKey);
    }

    const reservation = await this.prisma.visitReservation.findFirst({
      where: {
        id: reservationId,
        requesterId: payerId,
        status: VisitReservationStatus.CONFIRMED,
        confirmedStartAt: { gt: new Date() },
      },
      select: {
        id: true,
        reservationNumber: true,
        confirmedStartAt: true,
        deposit: { select: { id: true } },
      },
    });
    if (!reservation) {
      throw new ConflictException(
        '확정되었고 시작 전인 본인 방문 예약만 결제할 수 있습니다.',
      );
    }
    if (reservation.deposit) {
      const existing = await this.prisma.reservationDeposit.findUniqueOrThrow({
        where: { id: reservation.deposit.id },
        include: depositInclude,
      });
      return this.view(existing);
    }

    const id = createId();
    const paymentNumber = this.paymentNumber(id);
    const consentedAt = new Date();
    try {
      const deposit = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.reservationDeposit.create({
            data: {
              id,
              paymentNumber,
              reservationId,
              payerId,
              amount: this.amount,
              currency: this.currency,
              provider: this.provider.name,
              prepareIdempotencyKey: key,
              policyVersion: this.policyVersion,
              policySnapshot: {
                userCancellationRefundRate:
                  this.userCancellationRefundRate.toString(),
                platformOrBrokerCancellationRefundRate: '1',
                unstartedServiceRefundRate: '1',
                cardFeePassedToConsumer: false,
                refundDeadlineCalendarDays: 3,
                legalReviewRequiredBeforeProduction: true,
                consentedAt: consentedAt.toISOString(),
              },
            },
          });
          await transaction.paymentTransaction.create({
            data: {
              id: createId(),
              depositId: id,
              type: PaymentTransactionType.PREPARE,
              status: PaymentTransactionStatus.SUCCEEDED,
              amount: this.amount,
              currency: this.currency,
              idempotencyKey: `prepare:${key}`,
              attempts: 1,
              completedAt: consentedAt,
            },
          });
          await transaction.auditLog.create({
            data: {
              id: createId(),
              actorId: payerId,
              action: 'RESERVATION_DEPOSIT.PREPARE',
              targetType: 'ReservationDeposit',
              targetId: id,
              afterData: {
                reservationId,
                reservationNumber: reservation.reservationNumber,
                paymentNumber,
                amount: this.amount.toString(),
                currency: this.currency,
                policyVersion: this.policyVersion,
                refundPolicyConsented: true,
              },
            },
          });
          return transaction.reservationDeposit.findUniqueOrThrow({
            where: { id },
            include: depositInclude,
          });
        },
      );
      return this.view(deposit);
    } catch (error: unknown) {
      if (this.prismaCode(error) === 'P2002') {
        throw new ConflictException(
          '이미 준비된 예약금 결제 또는 사용된 멱등성 키입니다.',
        );
      }
      throw error;
    }
  }

  async confirm(
    payerId: string,
    reservationId: string,
    input: {
      paymentKey?: string;
      kcpEncData?: string;
      kcpEncInfo?: string;
      kcpPayType?: string;
      amount: string;
      currency: string;
      idempotencyKey: string;
    },
  ) {
    const key = this.idempotencyKey(input.idempotencyKey);
    const deposit = await this.ownedDeposit(payerId, reservationId);
    this.assertPaymentAmount(deposit, input.amount, input.currency);

    const existingTransaction =
      await this.prisma.paymentTransaction.findUnique({
        where: { idempotencyKey: key },
      });
    if (existingTransaction) {
      if (existingTransaction.depositId !== deposit.id) {
        throw new ConflictException(
          '멱등성 키가 다른 결제 요청에 사용되었습니다.',
        );
      }
      if (existingTransaction.status === PaymentTransactionStatus.SUCCEEDED) {
        return this.get(payerId, reservationId);
      }
    }
    if (deposit.status === ReservationDepositStatus.PAID) {
      return this.view(deposit);
    }
    if (deposit.status !== ReservationDepositStatus.READY) {
      throw new ConflictException('현재 상태에서는 결제를 승인할 수 없습니다.');
    }

    const transactionId = existingTransaction?.id ?? createId();
    if (!existingTransaction) {
      await this.prisma.paymentTransaction.create({
        data: {
          id: transactionId,
          depositId: deposit.id,
          type: PaymentTransactionType.CAPTURE,
          amount: deposit.amount,
          currency: deposit.currency,
          idempotencyKey: key,
        },
      });
    }

    try {
      const approval = await this.provider.capture({
        provider: deposit.provider as PaymentProviderName,
        paymentKey: input.paymentKey,
        kcpEncData: input.kcpEncData,
        kcpEncInfo: input.kcpEncInfo,
        kcpPayType: input.kcpPayType,
        paymentNumber: deposit.paymentNumber,
        amount: deposit.amount.toString(),
        currency: deposit.currency,
        idempotencyKey: key,
      });
      const paidAt = approval.approvedAt;
      const saved = await this.prisma.$transaction(async (transaction) => {
        await transaction.paymentTransaction.update({
          where: { id: transactionId },
          data: {
            status: PaymentTransactionStatus.SUCCEEDED,
            attempts: { increment: 1 },
            providerTransactionId: approval.providerTransactionId,
            errorCode: null,
            completedAt: paidAt,
          },
        });
        await transaction.reservationDeposit.update({
          where: { id: deposit.id },
          data: {
            status: ReservationDepositStatus.PAID,
            providerPaymentReference: approval.providerTransactionId,
            paidAt,
            failureCode: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: payerId,
            action: 'RESERVATION_DEPOSIT.CAPTURE',
            targetType: 'ReservationDeposit',
            targetId: deposit.id,
            afterData: {
              reservationId,
              status: ReservationDepositStatus.PAID,
              amount: deposit.amount.toString(),
              currency: deposit.currency,
            },
          },
        });
        return transaction.reservationDeposit.findUniqueOrThrow({
          where: { id: deposit.id },
          include: depositInclude,
        });
      });
      return this.view(saved);
    } catch (error: unknown) {
      await this.prisma.paymentTransaction.update({
        where: { id: transactionId },
        data: {
          status: PaymentTransactionStatus.FAILED,
          attempts: { increment: 1 },
          errorCode: this.errorCode(error),
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async get(payerId: string, reservationId: string) {
    return this.view(await this.ownedDeposit(payerId, reservationId));
  }

  async queueReservationRefund(
    transaction: Prisma.TransactionClient,
    reservationId: string,
    actorId: string,
    reason: ReservationRefundReason,
  ) {
    const deposit = await transaction.reservationDeposit.findUnique({
      where: { reservationId },
    });
    if (!deposit || deposit.status !== ReservationDepositStatus.PAID) {
      return null;
    }
    const rate =
      reason === ReservationRefundReason.USER_CANCELLATION
        ? this.userCancellationRefundRate
        : new Prisma.Decimal(1);
    const refundAmount = deposit.amount.mul(rate).toDecimalPlaces(0);
    const retainedAmount = deposit.amount.minus(refundAmount);
    const idempotencyKey = `refund:${deposit.id}:${reason}`;
    await transaction.paymentTransaction.upsert({
      where: { idempotencyKey },
      create: {
        id: createId(),
        depositId: deposit.id,
        type: PaymentTransactionType.REFUND,
        amount: refundAmount,
        currency: deposit.currency,
        idempotencyKey,
        refundReason: reason,
      },
      update: {},
    });
    await transaction.reservationDeposit.update({
      where: { id: deposit.id },
      data: {
        status: ReservationDepositStatus.REFUND_PENDING,
        refundRequestedAt: new Date(),
        refundDueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000),
        refundedAmount: refundAmount,
        retainedAmount,
      },
    });
    await transaction.auditLog.create({
      data: {
        id: createId(),
        actorId,
        action: 'RESERVATION_DEPOSIT.REFUND_REQUEST',
        targetType: 'ReservationDeposit',
        targetId: deposit.id,
        reason,
        beforeData: { status: deposit.status },
        afterData: {
          status: ReservationDepositStatus.REFUND_PENDING,
          refundAmount: refundAmount.toString(),
          retainedAmount: retainedAmount.toString(),
          refundRate: rate.toString(),
        },
      },
    });
    return deposit.id;
  }

  async processPendingReservationRefund(reservationId: string) {
    const deposit = await this.prisma.reservationDeposit.findUnique({
      where: { reservationId },
      include: depositInclude,
    });
    if (!deposit) {
      return null;
    }
    if (deposit.status !== ReservationDepositStatus.REFUND_PENDING) {
      return this.view(deposit);
    }
    const refund = [...deposit.transactions]
      .reverse()
      .find(
        (item) =>
          item.type === PaymentTransactionType.REFUND &&
          (item.status === PaymentTransactionStatus.PENDING ||
            item.status === PaymentTransactionStatus.FAILED),
      );
    if (!refund || !deposit.providerPaymentReference) {
      return this.view(deposit);
    }
    try {
      const result = await this.provider.refund({
        provider: deposit.provider as PaymentProviderName,
        providerPaymentReference: deposit.providerPaymentReference,
        paymentNumber: deposit.paymentNumber,
        amount: refund.amount.toString(),
        currency: refund.currency,
        reason: refund.refundReason ?? 'UNKNOWN',
        idempotencyKey: refund.idempotencyKey,
      });
      const finalStatus = deposit.retainedAmount.isZero()
        ? ReservationDepositStatus.REFUNDED
        : ReservationDepositStatus.PARTIALLY_REFUNDED;
      const saved = await this.prisma.$transaction(async (transaction) => {
        await transaction.paymentTransaction.update({
          where: { id: refund.id },
          data: {
            status: PaymentTransactionStatus.SUCCEEDED,
            attempts: { increment: 1 },
            providerTransactionId: result.providerTransactionId,
            errorCode: null,
            completedAt: result.refundedAt,
          },
        });
        await transaction.reservationDeposit.update({
          where: { id: deposit.id },
          data: {
            status: finalStatus,
            refundedAt: result.refundedAt,
            failureCode: null,
          },
        });
        await transaction.notificationOutbox.create({
          data: {
            id: createId(),
            recipientUserId: deposit.payerId,
            type: 'RESERVATION_DEPOSIT_REFUNDED',
            aggregateType: 'ReservationDeposit',
            aggregateId: deposit.id,
            payload: {
              reservationId,
              status: finalStatus,
              refundedAmount: refund.amount.toString(),
              retainedAmount: deposit.retainedAmount.toString(),
              currency: deposit.currency,
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: null,
            action: 'RESERVATION_DEPOSIT.REFUND_COMPLETE',
            targetType: 'ReservationDeposit',
            targetId: deposit.id,
            afterData: {
              status: finalStatus,
              refundedAmount: refund.amount.toString(),
              retainedAmount: deposit.retainedAmount.toString(),
            },
          },
        });
        return transaction.reservationDeposit.findUniqueOrThrow({
          where: { id: deposit.id },
          include: depositInclude,
        });
      });
      return this.view(saved);
    } catch (error: unknown) {
      await this.prisma.paymentTransaction.update({
        where: { id: refund.id },
        data: {
          status: PaymentTransactionStatus.FAILED,
          attempts: { increment: 1 },
          errorCode: this.errorCode(error),
          completedAt: new Date(),
        },
      });
      return this.view(deposit);
    }
  }

  private async ownedDeposit(payerId: string, reservationId: string) {
    const deposit = await this.prisma.reservationDeposit.findFirst({
      where: { reservationId, payerId },
      include: depositInclude,
    });
    if (!deposit) {
      throw new NotFoundException('예약금 결제를 찾을 수 없습니다.');
    }
    return deposit;
  }

  private assertPaymentAmount(
    deposit: DepositViewInput,
    amount: string,
    currency: string,
  ) {
    let requested: Prisma.Decimal;
    try {
      requested = new Prisma.Decimal(amount);
    } catch {
      throw new BadRequestException('결제 금액이 올바르지 않습니다.');
    }
    if (
      !requested.equals(deposit.amount) ||
      currency.toUpperCase() !== deposit.currency
    ) {
      throw new BadRequestException('준비된 결제 금액·통화와 일치하지 않습니다.');
    }
  }

  private idempotencyKey(value: string): string {
    const key = value.trim();
    if (key.length < 16 || key.length > 100) {
      throw new BadRequestException(
        'Idempotency-Key는 16~100자로 보내야 합니다.',
      );
    }
    return key;
  }

  private depositAmount(): Prisma.Decimal {
    const value = process.env.RESERVATION_DEPOSIT_AMOUNT_KRW ?? '10000';
    const amount = new Prisma.Decimal(value);
    if (!amount.isInteger() || amount.lessThanOrEqualTo(0)) {
      throw new Error('RESERVATION_DEPOSIT_AMOUNT_KRW must be a positive integer.');
    }
    return amount;
  }

  private refundRate(value: string | undefined, fallback: string) {
    const rate = new Prisma.Decimal(value ?? fallback);
    if (!rate.equals(1)) {
      throw new Error(
        'RESERVATION_USER_CANCELLATION_REFUND_RATE must be 1.00 under the current domestic policy.',
      );
    }
    return rate;
  }

  private paymentNumber(id: string): string {
    return `PAY-${new Date().getUTCFullYear()}-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  private prismaCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  }

  private errorCode(error: unknown): string {
    if (error instanceof PaymentProviderException) {
      return error.providerCode.slice(0, 80);
    }
    if (error && typeof error === 'object' && 'name' in error) {
      return String((error as { name?: unknown }).name).slice(0, 80);
    }
    return 'PAYMENT_PROVIDER_ERROR';
  }

  view(deposit: DepositViewInput) {
    return {
      id: deposit.id,
      paymentNumber: deposit.paymentNumber,
      reservationId: deposit.reservationId,
      amount: deposit.amount.toString(),
      currency: deposit.currency,
      status: deposit.status,
      provider: deposit.provider,
      policyVersion: deposit.policyVersion,
      refundedAmount: deposit.refundedAmount.toString(),
      retainedAmount: deposit.retainedAmount.toString(),
      paidAt: deposit.paidAt?.toISOString() ?? null,
      refundRequestedAt:
        deposit.refundRequestedAt?.toISOString() ?? null,
      refundDueAt: deposit.refundDueAt?.toISOString() ?? null,
      refundOverdue:
        deposit.status === ReservationDepositStatus.REFUND_PENDING &&
        Boolean(deposit.refundDueAt && deposit.refundDueAt < new Date()),
      refundedAt: deposit.refundedAt?.toISOString() ?? null,
      visitAccessGranted: deposit.status === ReservationDepositStatus.PAID,
      transactions: deposit.transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount.toString(),
        currency: transaction.currency,
        refundReason: transaction.refundReason,
        attempts: transaction.attempts,
        requestedAt: transaction.requestedAt.toISOString(),
        completedAt: transaction.completedAt?.toISOString() ?? null,
      })),
    };
  }
}
