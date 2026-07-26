import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  PaymentTransactionStatus,
  PaymentTransactionType,
  Prisma,
  ReservationDepositStatus,
  ReservationRefundReason,
} from '../generated/prisma/client';
import type { PaymentProviderService } from './payment-provider.service';
import { AdminPaymentsService } from './admin-payments.service';

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: '019c75df-0255-7000-8000-000000000401',
  paymentNumber: 'PAY-2026-019C75DF0401',
  reservationId: '019c75df-0255-7000-8000-000000000402',
  payerId: '019c75df-0255-7000-8000-000000000403',
  amount: new Prisma.Decimal('10000'),
  currency: 'KRW',
  status: ReservationDepositStatus.REFUND_PENDING,
  provider: 'MOCK',
  providerPaymentReference: 'mock-capture-401',
  prepareIdempotencyKey: 'prepare-key-00000401',
  policyVersion: '2026-07-v2',
  policySnapshot: {},
  refundedAmount: new Prisma.Decimal('10000'),
  retainedAmount: new Prisma.Decimal(0),
  paidAt: new Date(),
  refundRequestedAt: new Date(),
  refundDueAt: new Date(Date.now() + 86_400_000),
  refundedAt: null,
  failureCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  payer: { memberNumber: 'M-2026-0401' },
  reservation: {
    reservationNumber: 'VR-2026-0401',
    property: { listingNumber: 'LH-2026-0401', title: '테스트 매물' },
  },
  transactions: [
    {
      id: '019c75df-0255-7000-8000-000000000404',
      depositId: '019c75df-0255-7000-8000-000000000401',
      type: PaymentTransactionType.REFUND,
      status: PaymentTransactionStatus.FAILED,
      amount: new Prisma.Decimal('10000'),
      currency: 'KRW',
      idempotencyKey: 'refund-key-00000401',
      providerTransactionId: null,
      refundReason: ReservationRefundReason.USER_CANCELLATION,
      attempts: 1,
      errorCode: 'TEMPORARY_ERROR',
      requestedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  ...overrides,
});

describe('AdminPaymentsService', () => {
  it('rejects a short retry idempotency key before reading payment data', async () => {
    const prisma = {
      reservationDeposit: { findUnique: vi.fn() },
    } as unknown as PrismaService;
    const service = new AdminPaymentsService(
      prisma,
      {} as PaymentProviderService,
    );

    await expect(
      service.retryRefund(payment().id, payment().payerId, 'short'),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks retry for a payment outside refund-pending state', async () => {
    const prisma = {
      reservationDeposit: {
        findUnique: vi.fn(async () =>
          payment({ status: ReservationDepositStatus.REFUNDED }),
        ),
      },
    } as unknown as PrismaService;
    const service = new AdminPaymentsService(
      prisma,
      {} as PaymentProviderService,
    );

    await expect(
      service.retryRefund(
        payment().id,
        payment().payerId,
        'admin-retry-key-00000401',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('prevents a second worker from claiming the same refund', async () => {
    const prisma = {
      reservationDeposit: { findUnique: vi.fn(async () => payment()) },
      paymentTransaction: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as PrismaService;
    const service = new AdminPaymentsService(
      prisma,
      {} as PaymentProviderService,
    );

    await expect(
      service.retryRefund(
        payment().id,
        payment().payerId,
        'admin-retry-key-00000402',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('completes a claimed refund and records an administrator audit trail', async () => {
    const current = payment();
    const final = payment({
      status: ReservationDepositStatus.REFUNDED,
      refundedAt: new Date(),
      transactions: [
        {
          ...payment().transactions[0],
          status: PaymentTransactionStatus.SUCCEEDED,
        },
      ],
    });
    const tx = {
      paymentTransaction: { update: vi.fn(async () => ({})) },
      reservationDeposit: { update: vi.fn(async () => ({})) },
      notificationOutbox: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      reservationDeposit: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(final),
      },
      paymentTransaction: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      auditLog: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (input: unknown) =>
        typeof input === 'function'
          ? (input as (client: typeof tx) => unknown)(tx)
          : input,
      ),
    } as unknown as PrismaService;
    const provider = {
      refund: vi.fn(async () => ({
        providerTransactionId: 'mock-refund-401',
        refundedAt: new Date(),
      })),
    } as unknown as PaymentProviderService;

    const result = await new AdminPaymentsService(prisma, provider).retryRefund(
      current.id,
      current.payerId,
      'admin-retry-key-00000403',
    );

    expect(result.status).toBe(ReservationDepositStatus.REFUNDED);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: current.payerId,
          action: 'RESERVATION_DEPOSIT.REFUND_RETRY_SUCCEEDED',
        }),
      }),
    );
  });

  it('records provider failure without exposing provider secrets', async () => {
    const current = payment();
    const transactionUpdate = vi.fn(async () => ({}));
    const depositUpdate = vi.fn(async () => ({}));
    const auditCreate = vi.fn(async () => ({}));
    const prisma = {
      reservationDeposit: {
        findUnique: vi.fn(async () => current),
        update: depositUpdate,
      },
      paymentTransaction: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: transactionUpdate,
      },
      auditLog: { create: auditCreate },
      $transaction: vi.fn(async (input: unknown) => input),
    } as unknown as PrismaService;
    const provider = {
      refund: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    } as unknown as PaymentProviderService;

    await expect(
      new AdminPaymentsService(prisma, provider).retryRefund(
        current.id,
        current.payerId,
        'admin-retry-key-00000404',
      ),
    ).rejects.toThrow('provider unavailable');

    expect(transactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentTransactionStatus.FAILED,
          errorCode: 'PAYMENT_PROVIDER_ERROR',
        }),
      }),
    );
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(
      'mock-capture-401',
    );
  });
});
