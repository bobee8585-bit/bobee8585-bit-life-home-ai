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
  Prisma,
  ReservationDepositStatus,
} from '../generated/prisma/client';
import {
  PaymentProviderException,
  PaymentProviderService,
  type PaymentProviderName,
} from './payment-provider.service';
import { ListAdminPaymentsDto } from './dto/list-admin-payments.dto';

const adminInclude = {
  payer: { select: { memberNumber: true } },
  reservation: {
    select: {
      reservationNumber: true,
      property: { select: { listingNumber: true, title: true } },
    },
  },
  transactions: { orderBy: { createdAt: 'asc' as const } },
} as const;

type AdminDeposit = Prisma.ReservationDepositGetPayload<{
  include: typeof adminInclude;
}>;

@Injectable()
export class AdminPaymentsService {
  private readonly processingTimeoutMs = 10 * 60 * 1_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProviderService,
  ) {}

  async list(query: ListAdminPaymentsDto) {
    const search = query.search?.trim();
    const where: Prisma.ReservationDepositWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { paymentNumber: { contains: search, mode: 'insensitive' } },
              {
                reservation: {
                  reservationNumber: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                reservation: {
                  property: {
                    listingNumber: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                payer: {
                  memberNumber: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.reservationDeposit.count({ where }),
      this.prisma.reservationDeposit.findMany({
        where,
        include: adminInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: items.map((item) => this.view(item)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async summary() {
    const now = new Date();
    const [amounts, pending, overdue, failed] = await this.prisma.$transaction([
      this.prisma.reservationDeposit.aggregate({
        where: {
          status: {
            in: [
              ReservationDepositStatus.PAID,
              ReservationDepositStatus.REFUND_PENDING,
              ReservationDepositStatus.PARTIALLY_REFUNDED,
              ReservationDepositStatus.REFUNDED,
            ],
          },
        },
        _sum: { amount: true, refundedAmount: true },
      }),
      this.prisma.reservationDeposit.count({
        where: { status: ReservationDepositStatus.REFUND_PENDING },
      }),
      this.prisma.reservationDeposit.count({
        where: {
          status: ReservationDepositStatus.REFUND_PENDING,
          refundDueAt: { lt: now },
        },
      }),
      this.prisma.paymentTransaction.count({
        where: {
          type: PaymentTransactionType.REFUND,
          status: PaymentTransactionStatus.FAILED,
        },
      }),
    ]);
    return {
      currency: 'KRW',
      paidAmount: amounts._sum.amount?.toString() ?? '0',
      refundedAmount: amounts._sum.refundedAmount?.toString() ?? '0',
      pendingRefundCount: pending,
      overdueRefundCount: overdue,
      failedRefundCount: failed,
      generatedAt: now.toISOString(),
    };
  }

  async get(depositId: string) {
    const deposit = await this.prisma.reservationDeposit.findUnique({
      where: { id: depositId },
      include: adminInclude,
    });
    if (!deposit) {
      throw new NotFoundException('결제 내역을 찾을 수 없습니다.');
    }
    return this.view(deposit);
  }

  async retryRefund(
    depositId: string,
    actorId: string,
    idempotencyKey: string,
  ) {
    const key = idempotencyKey.trim();
    if (key.length < 16 || key.length > 100) {
      throw new BadRequestException(
        'Idempotency-Key는 16~100자로 보내야 합니다.',
      );
    }
    const deposit = await this.prisma.reservationDeposit.findUnique({
      where: { id: depositId },
      include: adminInclude,
    });
    if (!deposit) {
      throw new NotFoundException('결제 내역을 찾을 수 없습니다.');
    }
    if (deposit.status !== ReservationDepositStatus.REFUND_PENDING) {
      throw new ConflictException('환불 대기 상태인 결제만 재처리할 수 있습니다.');
    }
    if (!deposit.providerPaymentReference) {
      throw new ConflictException('결제사 거래 참조값이 없습니다.');
    }
    const refund = [...deposit.transactions].reverse().find(
      (item) => item.type === PaymentTransactionType.REFUND,
    );
    if (!refund) {
      throw new ConflictException('재처리할 환불 거래가 없습니다.');
    }
    if (refund.status === PaymentTransactionStatus.SUCCEEDED) {
      return this.get(depositId);
    }

    const requestFingerprint = createHash('sha256')
      .update(`${depositId}:${refund.id}:${key}`)
      .digest('hex');
    const staleBefore = new Date(Date.now() - this.processingTimeoutMs);
    const claimed = await this.prisma.paymentTransaction.updateMany({
      where: {
        id: refund.id,
        depositId,
        OR: [
          {
            status: {
              in: [
                PaymentTransactionStatus.PENDING,
                PaymentTransactionStatus.FAILED,
              ],
            },
          },
          {
            status: PaymentTransactionStatus.PROCESSING,
            updatedAt: { lt: staleBefore },
          },
        ],
      },
      data: {
        status: PaymentTransactionStatus.PROCESSING,
        attempts: { increment: 1 },
        errorCode: null,
        completedAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('다른 작업자가 환불을 처리하고 있습니다.');
    }

    await this.prisma.auditLog.create({
      data: {
        id: createId(),
        actorId,
        action: 'RESERVATION_DEPOSIT.REFUND_RETRY_STARTED',
        targetType: 'ReservationDeposit',
        targetId: depositId,
        afterData: {
          transactionId: refund.id,
          requestFingerprint,
          previousStatus: refund.status,
        },
      },
    });

    try {
      const result = await this.provider.refund({
        provider: deposit.provider as PaymentProviderName,
        providerPaymentReference: deposit.providerPaymentReference,
        paymentNumber: deposit.paymentNumber,
        amount: refund.amount.toString(),
        currency: refund.currency,
        reason: refund.refundReason ?? 'ADMIN_OVERRIDE',
        idempotencyKey: refund.idempotencyKey,
      });
      const finalStatus = deposit.retainedAmount.isZero()
        ? ReservationDepositStatus.REFUNDED
        : ReservationDepositStatus.PARTIALLY_REFUNDED;
      await this.prisma.$transaction(async (transaction) => {
        await transaction.paymentTransaction.update({
          where: { id: refund.id },
          data: {
            status: PaymentTransactionStatus.SUCCEEDED,
            providerTransactionId: result.providerTransactionId,
            errorCode: null,
            completedAt: result.refundedAt,
          },
        });
        await transaction.reservationDeposit.update({
          where: { id: depositId },
          data: {
            status: finalStatus,
            failureCode: null,
            refundedAt: result.refundedAt,
          },
        });
        await transaction.notificationOutbox.create({
          data: {
            id: createId(),
            recipientUserId: deposit.payerId,
            type: 'RESERVATION_DEPOSIT_REFUNDED',
            aggregateType: 'ReservationDeposit',
            aggregateId: depositId,
            payload: {
              reservationId: deposit.reservationId,
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
            actorId,
            action: 'RESERVATION_DEPOSIT.REFUND_RETRY_SUCCEEDED',
            targetType: 'ReservationDeposit',
            targetId: depositId,
            afterData: {
              transactionId: refund.id,
              status: finalStatus,
              requestFingerprint,
            },
          },
        });
      });
      return this.get(depositId);
    } catch (error: unknown) {
      const failureCode = this.errorCode(error);
      await this.prisma.$transaction([
        this.prisma.paymentTransaction.update({
          where: { id: refund.id },
          data: {
            status: PaymentTransactionStatus.FAILED,
            errorCode: failureCode,
            completedAt: new Date(),
          },
        }),
        this.prisma.reservationDeposit.update({
          where: { id: depositId },
          data: { failureCode },
        }),
        this.prisma.auditLog.create({
          data: {
            id: createId(),
            actorId,
            action: 'RESERVATION_DEPOSIT.REFUND_RETRY_FAILED',
            targetType: 'ReservationDeposit',
            targetId: depositId,
            afterData: {
              transactionId: refund.id,
              failureCode,
              requestFingerprint,
            },
            succeeded: false,
          },
        }),
      ]);
      throw error;
    }
  }

  private errorCode(error: unknown) {
    if (error instanceof PaymentProviderException) {
      return error.providerCode.slice(0, 80);
    }
    return 'PAYMENT_PROVIDER_ERROR';
  }

  private view(deposit: AdminDeposit) {
    return {
      id: deposit.id,
      paymentNumber: deposit.paymentNumber,
      reservationNumber: deposit.reservation.reservationNumber,
      listingNumber: deposit.reservation.property.listingNumber,
      propertyTitle: deposit.reservation.property.title,
      memberNumber: deposit.payer.memberNumber,
      amount: deposit.amount.toString(),
      currency: deposit.currency,
      status: deposit.status,
      provider: deposit.provider,
      refundedAmount: deposit.refundedAmount.toString(),
      retainedAmount: deposit.retainedAmount.toString(),
      paidAt: deposit.paidAt?.toISOString() ?? null,
      refundRequestedAt: deposit.refundRequestedAt?.toISOString() ?? null,
      refundDueAt: deposit.refundDueAt?.toISOString() ?? null,
      refundOverdue:
        deposit.status === ReservationDepositStatus.REFUND_PENDING &&
        Boolean(deposit.refundDueAt && deposit.refundDueAt < new Date()),
      refundedAt: deposit.refundedAt?.toISOString() ?? null,
      failureCode: deposit.failureCode,
      transactions: deposit.transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount.toString(),
        currency: transaction.currency,
        refundReason: transaction.refundReason,
        attempts: transaction.attempts,
        errorCode: transaction.errorCode,
        requestedAt: transaction.requestedAt.toISOString(),
        completedAt: transaction.completedAt?.toISOString() ?? null,
      })),
    };
  }
}
