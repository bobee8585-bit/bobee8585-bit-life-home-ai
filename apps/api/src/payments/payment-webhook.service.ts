import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  PaymentTransactionStatus,
  PaymentTransactionType,
  PaymentWebhookEventStatus,
  Prisma,
  ReservationDepositStatus,
  ReservationRefundReason,
} from '../generated/prisma/client';
import {
  PaymentProviderException,
  PaymentProviderService,
  type PaymentProviderName,
  type PaymentProviderSnapshot,
} from './payment-provider.service';

const webhookDepositInclude = {
  transactions: { orderBy: { createdAt: 'desc' as const } },
} as const;

type WebhookDeposit = Prisma.ReservationDepositGetPayload<{
  include: typeof webhookDepositInclude;
}>;

@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProviderService,
  ) {}

  async handle(
    provider: Exclude<PaymentProviderName, 'MOCK'>,
    transmissionIdValue: string | undefined,
    payload: unknown,
  ) {
    const body = this.object(payload);
    const eventType = this.eventType(provider, body);
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const transmissionId = this.transmissionId(
      provider,
      transmissionIdValue,
      body,
      payloadHash,
    );

    const previous = await this.prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_transmissionId: {
          provider,
          transmissionId,
        },
      },
    });
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new ConflictException(
          '동일한 웹훅 전송 ID의 본문이 변경되었습니다.',
        );
      }
      if (
        previous.status === PaymentWebhookEventStatus.PROCESSED ||
        previous.status === PaymentWebhookEventStatus.IGNORED
      ) {
        return {
          accepted: true,
          duplicate: true,
          status: previous.status,
        };
      }
      if (previous.status === PaymentWebhookEventStatus.RECEIVED) {
        throw new ConflictException('동일한 웹훅을 처리 중입니다.');
      }
      await this.prisma.paymentWebhookEvent.update({
        where: { id: previous.id },
        data: {
          status: PaymentWebhookEventStatus.RECEIVED,
          attempts: { increment: 1 },
          failureCode: null,
        },
      });
      return this.process(previous.id, provider, payload);
    }

    const id = createId();
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          id,
          provider,
          transmissionId,
          eventType,
          payloadHash,
        },
      });
    } catch (error: unknown) {
      if (this.prismaCode(error) === 'P2002') {
        throw new ConflictException('동일한 웹훅을 처리 중입니다.');
      }
      throw error;
    }
    return this.process(id, provider, payload);
  }

  private async process(
    eventId: string,
    provider: Exclude<PaymentProviderName, 'MOCK'>,
    payload: unknown,
  ) {
    try {
      const verified = await this.provider.verifyPaymentWebhook(
        provider,
        payload,
      );
      if (!verified.snapshot) {
        await this.completeEvent(
          eventId,
          PaymentWebhookEventStatus.IGNORED,
          null,
        );
        return {
          accepted: true,
          duplicate: false,
          status: PaymentWebhookEventStatus.IGNORED,
        };
      }
      const result = await this.reconcile(
        eventId,
        provider,
        verified.snapshot,
      );
      return {
        accepted: true,
        duplicate: false,
        status: PaymentWebhookEventStatus.PROCESSED,
        depositId: result.depositId,
        paymentStatus: verified.snapshot.status,
      };
    } catch (error: unknown) {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: PaymentWebhookEventStatus.FAILED,
          failureCode: this.errorCode(error),
          processedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async reconcile(
    eventId: string,
    provider: Exclude<PaymentProviderName, 'MOCK'>,
    snapshot: PaymentProviderSnapshot,
  ) {
    const deposit = await this.prisma.reservationDeposit.findUnique({
      where: { paymentNumber: snapshot.orderId },
      include: webhookDepositInclude,
    });
    if (!deposit) {
      throw new NotFoundException('웹훅에 해당하는 예약금 주문이 없습니다.');
    }
    if (
      deposit.provider !== provider ||
      !deposit.amount.equals(new Prisma.Decimal(snapshot.totalAmount)) ||
      deposit.currency !== snapshot.currency
    ) {
      throw new BadRequestException(
        '웹훅 결제가 저장된 예약금 주문과 일치하지 않습니다.',
      );
    }

    if (snapshot.status === 'DONE') {
      await this.reconcilePaid(eventId, provider, deposit, snapshot);
    } else if (
      snapshot.status === 'CANCELED' ||
      snapshot.status === 'PARTIAL_CANCELED'
    ) {
      await this.reconcileCanceled(eventId, provider, deposit, snapshot);
    } else if (
      (snapshot.status === 'ABORTED' || snapshot.status === 'EXPIRED') &&
      deposit.status === ReservationDepositStatus.READY
    ) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.reservationDeposit.update({
          where: { id: deposit.id },
          data: {
            status: ReservationDepositStatus.FAILED,
            failureCode: `${provider}_${snapshot.status}`,
          },
        });
        await transaction.paymentWebhookEvent.update({
          where: { id: eventId },
          data: {
            status: PaymentWebhookEventStatus.PROCESSED,
            depositId: deposit.id,
            paymentReference: snapshot.paymentReference,
            orderId: snapshot.orderId,
            processedAt: new Date(),
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: null,
            action: 'RESERVATION_DEPOSIT.WEBHOOK_FAILED',
            targetType: 'ReservationDeposit',
            targetId: deposit.id,
            afterData: { providerStatus: snapshot.status },
          },
        });
      });
    } else {
      await this.completeEvent(
        eventId,
        PaymentWebhookEventStatus.PROCESSED,
        {
          depositId: deposit.id,
          paymentReference: snapshot.paymentReference,
          orderId: snapshot.orderId,
        },
      );
    }
    return { depositId: deposit.id };
  }

  private async reconcilePaid(
    eventId: string,
    provider: Exclude<PaymentProviderName, 'MOCK'>,
    deposit: WebhookDeposit,
    snapshot: PaymentProviderSnapshot,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      if (
        deposit.status === ReservationDepositStatus.READY ||
        deposit.status === ReservationDepositStatus.FAILED
      ) {
        const capture = deposit.transactions.find(
          (item) => item.type === PaymentTransactionType.CAPTURE,
        );
        if (capture) {
          await transaction.paymentTransaction.update({
            where: { id: capture.id },
            data: {
              status: PaymentTransactionStatus.SUCCEEDED,
              providerTransactionId: snapshot.paymentReference,
              errorCode: null,
              completedAt: snapshot.approvedAt ?? new Date(),
            },
          });
        } else {
          await transaction.paymentTransaction.create({
            data: {
              id: createId(),
              depositId: deposit.id,
              type: PaymentTransactionType.CAPTURE,
              status: PaymentTransactionStatus.SUCCEEDED,
              amount: deposit.amount,
              currency: deposit.currency,
              idempotencyKey: this.webhookTransactionKey(
                'capture',
                eventId,
              ),
              providerTransactionId: snapshot.paymentReference,
              attempts: 1,
              completedAt: snapshot.approvedAt ?? new Date(),
            },
          });
        }
        await transaction.reservationDeposit.update({
          where: { id: deposit.id },
          data: {
            status: ReservationDepositStatus.PAID,
            providerPaymentReference: snapshot.paymentReference,
            paidAt: snapshot.approvedAt ?? new Date(),
            failureCode: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: null,
            action: 'RESERVATION_DEPOSIT.WEBHOOK_CAPTURE_RECONCILED',
            targetType: 'ReservationDeposit',
            targetId: deposit.id,
            afterData: {
              provider,
              providerStatus: snapshot.status,
              amount: snapshot.totalAmount,
              currency: snapshot.currency,
            },
          },
        });
      }
      await transaction.paymentWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: PaymentWebhookEventStatus.PROCESSED,
          depositId: deposit.id,
          paymentReference: snapshot.paymentReference,
          orderId: snapshot.orderId,
          processedAt: new Date(),
        },
      });
    });
  }

  private async reconcileCanceled(
    eventId: string,
    provider: Exclude<PaymentProviderName, 'MOCK'>,
    deposit: WebhookDeposit,
    snapshot: PaymentProviderSnapshot,
  ) {
    const refundedAmount = new Prisma.Decimal(snapshot.canceledAmount);
    const retainedAmount = new Prisma.Decimal(snapshot.balanceAmount);
    if (
      refundedAmount.isNegative() ||
      retainedAmount.isNegative() ||
      !refundedAmount.plus(retainedAmount).equals(deposit.amount) ||
      !snapshot.lastCancellation
    ) {
      throw new BadRequestException(
        '공급자 취소 금액 합계가 예약금과 일치하지 않습니다.',
      );
    }
    const finalStatus = retainedAmount.isZero()
      ? ReservationDepositStatus.REFUNDED
      : ReservationDepositStatus.PARTIALLY_REFUNDED;
    const changed =
      deposit.status !== finalStatus ||
      !deposit.refundedAmount.equals(refundedAmount);

    await this.prisma.$transaction(async (transaction) => {
      if (changed) {
        const refund = deposit.transactions.find(
          (item) =>
            item.type === PaymentTransactionType.REFUND &&
            item.status !== PaymentTransactionStatus.SUCCEEDED,
        );
        if (refund) {
          await transaction.paymentTransaction.update({
            where: { id: refund.id },
            data: {
              status: PaymentTransactionStatus.SUCCEEDED,
              providerTransactionId:
                snapshot.lastCancellation?.transactionReference,
              errorCode: null,
              completedAt: snapshot.lastCancellation?.canceledAt,
            },
          });
        } else {
          const newlyRefunded = refundedAmount.minus(
            deposit.refundedAmount,
          );
          if (newlyRefunded.greaterThan(0)) {
            await transaction.paymentTransaction.create({
              data: {
                id: createId(),
                depositId: deposit.id,
                type: PaymentTransactionType.REFUND,
                status: PaymentTransactionStatus.SUCCEEDED,
                amount: newlyRefunded,
                currency: deposit.currency,
                idempotencyKey: this.webhookTransactionKey(
                  'refund',
                  eventId,
                ),
                providerTransactionId:
                  snapshot.lastCancellation?.transactionReference,
                refundReason: ReservationRefundReason.ADMIN_OVERRIDE,
                attempts: 1,
                completedAt: snapshot.lastCancellation?.canceledAt,
              },
            });
          }
        }
        await transaction.reservationDeposit.update({
          where: { id: deposit.id },
          data: {
            status: finalStatus,
            providerPaymentReference: snapshot.paymentReference,
            refundedAmount,
            retainedAmount,
            refundedAt: snapshot.lastCancellation?.canceledAt,
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
              reservationId: deposit.reservationId,
              status: finalStatus,
              refundedAmount: refundedAmount.toString(),
              retainedAmount: retainedAmount.toString(),
              currency: deposit.currency,
              source: `${provider}_WEBHOOK_RECONCILIATION`,
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: null,
            action: 'RESERVATION_DEPOSIT.WEBHOOK_REFUND_RECONCILED',
            targetType: 'ReservationDeposit',
            targetId: deposit.id,
            afterData: {
              provider,
              providerStatus: snapshot.status,
              refundedAmount: refundedAmount.toString(),
              retainedAmount: retainedAmount.toString(),
            },
          },
        });
      }
      await transaction.paymentWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: PaymentWebhookEventStatus.PROCESSED,
          depositId: deposit.id,
          paymentReference: snapshot.paymentReference,
          orderId: snapshot.orderId,
          processedAt: new Date(),
        },
      });
    });
  }

  private async completeEvent(
    eventId: string,
    status: PaymentWebhookEventStatus,
    data: {
      depositId: string;
      paymentReference: string;
      orderId: string;
    } | null,
  ) {
    await this.prisma.paymentWebhookEvent.update({
      where: { id: eventId },
      data: {
        status,
        ...(data ?? {}),
        processedAt: new Date(),
      },
    });
  }

  private eventType(
    provider: Exclude<PaymentProviderName, 'MOCK'>,
    body: Record<string, unknown>,
  ): string {
    if (provider === 'TOSS') {
      const eventType =
        typeof body.eventType === 'string' ? body.eventType : 'UNKNOWN';
      if (eventType !== 'PAYMENT_STATUS_CHANGED') {
        throw new BadRequestException(
          '지원하지 않는 토스페이먼츠 웹훅 이벤트입니다.',
        );
      }
      return eventType;
    }
    if (provider === 'NHN_KCP') {
      if (body.tx_cd !== 'TX00') {
        throw new BadRequestException(
          '지원하지 않는 NHN KCP 웹훅 업무 코드입니다.',
        );
      }
      return 'TX00';
    }
    const status =
      typeof body.status === 'string' ? body.status : 'UNKNOWN';
    if (status === 'UNKNOWN') {
      throw new BadRequestException(
        '나이스페이 웹훅 결제 상태가 필요합니다.',
      );
    }
    return 'PAYMENT_STATUS_CHANGED';
  }

  private transmissionId(
    provider: Exclude<PaymentProviderName, 'MOCK'>,
    value: string | undefined,
    body: Record<string, unknown>,
    payloadHash: string,
  ): string {
    const id = value?.trim();
    if (id && id.length >= 8 && id.length <= 200) {
      return id;
    }
    if (provider === 'TOSS') {
      throw new BadRequestException(
        '유효한 토스페이먼츠 웹훅 전송 ID가 필요합니다.',
      );
    }
    const source =
      provider === 'NHN_KCP'
        ? [
            body.site_cd,
            body.tno,
            body.order_no,
            body.tx_cd,
            body.tx_tm,
          ].join(':')
        : [body.tid, body.orderId, body.status, body.ediDate].join(':');
    const digest = createHash('sha256')
      .update(source.includes('undefined') ? payloadHash : source)
      .digest('hex')
      .slice(0, 56);
    return `${provider.toLowerCase()}:${digest}`;
  }

  private webhookTransactionKey(type: string, eventId: string): string {
    return `webhook:${type}:${createHash('sha256')
      .update(eventId)
      .digest('hex')
      .slice(0, 48)}`;
  }

  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('웹훅 본문이 올바르지 않습니다.');
    }
    return value as Record<string, unknown>;
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
    return 'PAYMENT_WEBHOOK_ERROR';
  }
}
