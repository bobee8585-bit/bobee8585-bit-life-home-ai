import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  PaymentTransactionStatus,
  PaymentTransactionType,
  PaymentWebhookEventStatus,
  Prisma,
  ReservationDepositStatus,
} from '../generated/prisma/client';
import type { PaymentProviderService } from './payment-provider.service';
import { PaymentWebhookService } from './payment-webhook.service';

const snapshot = {
  paymentReference: 'toss_payment_key',
  orderId: 'PAY-2026-WEBHOOK',
  totalAmount: '10000',
  balanceAmount: '10000',
  canceledAmount: '0',
  currency: 'KRW',
  status: 'DONE',
  approvedAt: new Date('2026-07-25T01:00:00+09:00'),
  lastCancellation: null,
};

const deposit = {
  id: '019c75df-0255-7000-8000-000000000401',
  paymentNumber: snapshot.orderId,
  reservationId: '019c75df-0255-7000-8000-000000000402',
  payerId: '019c75df-0255-7000-8000-000000000403',
  amount: new Prisma.Decimal('10000'),
  currency: 'KRW',
  status: ReservationDepositStatus.READY,
  provider: 'TOSS',
  providerPaymentReference: null,
  prepareIdempotencyKey: 'prepare-key-00000002',
  policyVersion: '2026-07-v2',
  policySnapshot: {},
  refundedAmount: new Prisma.Decimal(0),
  retainedAmount: new Prisma.Decimal(0),
  paidAt: null,
  refundRequestedAt: null,
  refundDueAt: null,
  refundedAt: null,
  failureCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  transactions: [
    {
      id: '019c75df-0255-7000-8000-000000000404',
      depositId: '019c75df-0255-7000-8000-000000000401',
      type: PaymentTransactionType.CAPTURE,
      status: PaymentTransactionStatus.FAILED,
      amount: new Prisma.Decimal('10000'),
      currency: 'KRW',
      idempotencyKey: 'confirm-key-00000005',
      providerTransactionId: null,
      refundReason: null,
      attempts: 1,
      errorCode: 'TOSS_NETWORK_ERROR',
      requestedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

describe('PaymentWebhookService', () => {
  it('returns an already processed transmission without calling the provider', async () => {
    const payload = {
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: { paymentKey: snapshot.paymentReference, orderId: snapshot.orderId },
    };
    const provider = { verifyPaymentWebhook: vi.fn() };
    const prisma = {
      paymentWebhookEvent: {
        findUnique: vi.fn(async () => ({
          id: '019c75df-0255-7000-8000-000000000405',
          payloadHash: await import('node:crypto').then(({ createHash }) =>
            createHash('sha256')
              .update(JSON.stringify(payload))
              .digest('hex'),
          ),
          status: PaymentWebhookEventStatus.PROCESSED,
        })),
      },
    } as unknown as PrismaService;

    const result = await new PaymentWebhookService(
      prisma,
      provider as unknown as PaymentProviderService,
    ).handle('TOSS', 'transmission-00000001', payload);

    expect(result).toEqual({
      accepted: true,
      duplicate: true,
      status: PaymentWebhookEventStatus.PROCESSED,
    });
    expect(provider.verifyPaymentWebhook).not.toHaveBeenCalled();
  });

  it('recovers a successful payment after an API response was lost', async () => {
    const paymentWebhookEvent = {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    };
    const transaction = {
      paymentTransaction: { update: vi.fn(async () => ({})) },
      reservationDeposit: { update: vi.fn(async () => ({})) },
      paymentWebhookEvent: { update: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      paymentWebhookEvent,
      reservationDeposit: { findUnique: vi.fn(async () => deposit) },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const provider = {
      verifyPaymentWebhook: vi.fn(async () => ({
        eventType: 'PAYMENT_STATUS_CHANGED',
        snapshot,
      })),
    };

    const result = await new PaymentWebhookService(
      prisma,
      provider as unknown as PaymentProviderService,
    ).handle('TOSS', 'transmission-00000002', {
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: {
        paymentKey: snapshot.paymentReference,
        orderId: snapshot.orderId,
        totalAmount: 10000,
        currency: 'KRW',
      },
    });

    expect(result.paymentStatus).toBe('DONE');
    expect(transaction.reservationDeposit.update).toHaveBeenCalledWith({
      where: { id: deposit.id },
      data: expect.objectContaining({
        status: ReservationDepositStatus.PAID,
        providerPaymentReference: snapshot.paymentReference,
      }),
    });
    expect(transaction.paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: deposit.transactions[0].id },
      data: expect.objectContaining({
        status: PaymentTransactionStatus.SUCCEEDED,
      }),
    });
  });

  it('reconciles an externally completed full refund without duplicate payout', async () => {
    const canceledAt = new Date('2026-07-25T02:00:00+09:00');
    const canceledSnapshot = {
      ...snapshot,
      status: 'CANCELED',
      balanceAmount: '0',
      canceledAmount: '10000',
      lastCancellation: {
        transactionReference: 'toss_cancel_transaction',
        canceledAt,
      },
    };
    const refundTransaction = {
      ...deposit.transactions[0],
      id: '019c75df-0255-7000-8000-000000000406',
      type: PaymentTransactionType.REFUND,
      status: PaymentTransactionStatus.PENDING,
      providerTransactionId: null,
    };
    const refundPending = {
      ...deposit,
      status: ReservationDepositStatus.REFUND_PENDING,
      providerPaymentReference: snapshot.paymentReference,
      refundedAmount: new Prisma.Decimal('10000'),
      transactions: [refundTransaction],
    };
    const transaction = {
      paymentTransaction: { update: vi.fn(async () => ({})) },
      reservationDeposit: { update: vi.fn(async () => ({})) },
      paymentWebhookEvent: { update: vi.fn(async () => ({})) },
      notificationOutbox: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      paymentWebhookEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      reservationDeposit: {
        findUnique: vi.fn(async () => refundPending),
      },
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaService;
    const provider = {
      verifyPaymentWebhook: vi.fn(async () => ({
        eventType: 'PAYMENT_STATUS_CHANGED',
        snapshot: canceledSnapshot,
      })),
    };

    const result = await new PaymentWebhookService(
      prisma,
      provider as unknown as PaymentProviderService,
    ).handle('TOSS', 'transmission-00000003', {
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: {
        paymentKey: snapshot.paymentReference,
        orderId: snapshot.orderId,
        totalAmount: 10000,
        currency: 'KRW',
      },
    });

    expect(result.paymentStatus).toBe('CANCELED');
    expect(transaction.reservationDeposit.update).toHaveBeenCalledWith({
      where: { id: deposit.id },
      data: expect.objectContaining({
        status: ReservationDepositStatus.REFUNDED,
        refundedAmount: expect.objectContaining({}),
        retainedAmount: expect.objectContaining({}),
        refundedAt: canceledAt,
      }),
    });
    expect(transaction.paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: refundTransaction.id },
      data: expect.objectContaining({
        status: PaymentTransactionStatus.SUCCEEDED,
        providerTransactionId: 'toss_cancel_transaction',
      }),
    });
  });
});
