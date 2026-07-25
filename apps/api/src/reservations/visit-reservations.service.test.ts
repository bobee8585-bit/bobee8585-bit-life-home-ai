import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { VisitReservationStatus } from '../generated/prisma/client';
import { VisitReservationsService } from './visit-reservations.service';
import type { ReservationDepositService } from '../payments/reservation-deposit.service';

const future = (hours: number) =>
  new Date(Date.now() + hours * 60 * 60 * 1_000);

const reservation = (status: VisitReservationStatus) => ({
  id: '019c75df-0255-7000-8000-000000000201',
  reservationNumber: 'VR-2026-019C75DF0255',
  propertyId: '019c75df-0255-7000-8000-000000000202',
  requesterId: '019c75df-0255-7000-8000-000000000203',
  brokerUserId: '019c75df-0255-7000-8000-000000000204',
  status,
  requestedStartAt: future(24),
  requestedEndAt: future(25),
  alternativeStartAt: future(48),
  alternativeEndAt: future(49),
  alternativeExpiresAt: future(12),
  confirmedStartAt:
    status === VisitReservationStatus.CONFIRMED ? future(24) : null,
  confirmedEndAt:
    status === VisitReservationStatus.CONFIRMED ? future(25) : null,
  requestMessage: null,
  responseMessage: null,
  cancellationReason: null,
  respondedAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  property: {
    id: '019c75df-0255-7000-8000-000000000202',
    listingNumber: 'LH-2026-TEST',
    title: '방문 예약 테스트 매물',
    status: 'ACTIVE',
    city: '서울',
    addressLine1: '서울특별시 테스트로 1',
    brokerageOffice: {
      id: '019c75df-0255-7000-8000-000000000205',
      name: '테스트 공인중개사무소',
    },
  },
  requester: {
    memberNumber: 'LH-U-001',
    profile: { displayName: '예약자' },
  },
  broker: {
    memberNumber: 'LH-B-001',
    profile: { displayName: '중개사' },
  },
  histories: [],
  deposit: null,
});

describe('VisitReservationsService', () => {
  it('requires phone identity verification before a visit request', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({ phoneVerifiedAt: null })),
      },
      property: {
        findFirst: vi.fn(async () => ({
          id: 'property',
          brokerUserId: 'broker',
          listingNumber: 'LH-TEST',
          title: '테스트',
        })),
      },
    } as unknown as PrismaService;
    const service = new VisitReservationsService(
      prisma,
      {} as ReservationDepositService,
    );

    await expect(
      service.create('requester', 'property', {
        startAt: future(24).toISOString(),
        endAt: future(25).toISOString(),
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a visit window shorter than thirty minutes', async () => {
    const service = new VisitReservationsService(
      {} as PrismaService,
      {} as ReservationDepositService,
    );
    const startAt = future(24);

    await expect(
      service.create('requester', 'property', {
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + 15 * 60 * 1_000).toISOString(),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('confirms only after the listing broker approves', async () => {
    const requested = reservation(VisitReservationStatus.REQUESTED);
    const confirmed = {
      ...requested,
      status: VisitReservationStatus.CONFIRMED,
      confirmedStartAt: requested.requestedStartAt,
      confirmedEndAt: requested.requestedEndAt,
    };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(requested)
      .mockResolvedValueOnce(null);
    const transaction = {
      visitReservation: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => confirmed),
      },
      visitReservationHistory: { create: vi.fn(async () => ({})) },
      notificationOutbox: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      visitReservation: { findFirst },
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const result = await new VisitReservationsService(
      prisma,
      {} as ReservationDepositService,
    ).approve(
      requested.brokerUserId,
      requested.id,
      '예약을 승인합니다.',
    );

    expect(result.status).toBe(VisitReservationStatus.CONFIRMED);
    expect(result.autoConfirmed).toBe(false);
    expect(transaction.notificationOutbox.create).toHaveBeenCalledOnce();
  });

  it('rejects an expired alternative response', async () => {
    const proposed = {
      ...reservation(VisitReservationStatus.ALTERNATIVE_PROPOSED),
      alternativeExpiresAt: new Date(Date.now() - 1_000),
    };
    const prisma = {
      visitReservation: {
        findFirst: vi.fn(async () => proposed),
      },
    } as unknown as PrismaService;

    await expect(
      new VisitReservationsService(
        prisma,
        {} as ReservationDepositService,
      ).acceptAlternative(
        proposed.requesterId,
        proposed.id,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
