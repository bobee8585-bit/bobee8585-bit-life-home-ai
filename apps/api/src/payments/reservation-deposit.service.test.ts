import { BadRequestException } from '@nestjs/common';
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
import { ReservationDepositService } from './reservation-deposit.service';

const deposit = () => ({
  id: '019c75df-0255-7000-8000-000000000301',
  paymentNumber: 'PAY-2026-019C75DF0255',
  reservationId: '019c75df-0255-7000-8000-000000000302',
  payerId: '019c75df-0255-7000-8000-000000000303',
  amount: new Prisma.Decimal('10000'),
  currency: 'KRW',
  status: ReservationDepositStatus.READY,
  provider: 'MOCK',
  providerPaymentReference: null,
  prepareIdempotencyKey: 'prepare-key-00000001',
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
  transactions: [],
});

describe('ReservationDepositService', () => {
  it('returns the existing prepare result for the same idempotency key', async () => {
    const existing = deposit();
    const prisma = {
      reservationDeposit: {
        findUnique: vi.fn(async () => existing),
      },
    } as unknown as PrismaService;
    const result = await new ReservationDepositService(
      prisma,
      { name: 'MOCK' } as PaymentProviderService,
    ).prepare(
      existing.payerId,
      existing.reservationId,
      existing.prepareIdempotencyKey,
    );

    expect(result.paymentNumber).toBe(existing.paymentNumber);
    expect(result.status).toBe(ReservationDepositStatus.READY);
  });

  it('rejects a confirmation amount that differs from the prepared amount', async () => {
    const existing = deposit();
    const prisma = {
      reservationDeposit: {
        findFirst: vi.fn(async () => existing),
      },
    } as unknown as PrismaService;
    const service = new ReservationDepositService(
      prisma,
      { name: 'MOCK' } as PaymentProviderService,
    );

    await expect(
      service.confirm(existing.payerId, existing.reservationId, {
        paymentKey: 'mock_payment_01',
        amount: '9000',
        currency: 'KRW',
        idempotencyKey: 'confirm-key-00000001',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('queues a full user cancellation refund before the visit', async () => {
    const paid = {
      ...deposit(),
      status: ReservationDepositStatus.PAID,
      providerPaymentReference: 'mock-capture-payment',
    };
    const paymentTransaction = {
      upsert: vi.fn(async (args) => args.create),
    };
    const reservationDeposit = {
      findUnique: vi.fn(async () => paid),
      update: vi.fn(async (args) => args.data),
    };
    const transaction = {
      reservationDeposit,
      paymentTransaction,
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const service = new ReservationDepositService(
      {} as PrismaService,
      { name: 'MOCK' } as PaymentProviderService,
    );

    await service.queueReservationRefund(
      transaction as never,
      paid.reservationId,
      paid.payerId,
      ReservationRefundReason.USER_CANCELLATION,
    );

    const transactionData = paymentTransaction.upsert.mock.calls[0]?.[0]
      .create as {
      type: PaymentTransactionType;
      amount: Prisma.Decimal;
      status?: PaymentTransactionStatus;
    };
    expect(transactionData.type).toBe(PaymentTransactionType.REFUND);
    expect(transactionData.amount.toString()).toBe('10000');
    expect(reservationDeposit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ReservationDepositStatus.REFUND_PENDING,
          refundedAmount: expect.objectContaining({}),
          retainedAmount: expect.objectContaining({}),
        }),
      }),
    );
  });
});
