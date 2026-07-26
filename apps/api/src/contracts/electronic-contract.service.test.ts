import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  ElectronicContractPartyRole,
  ElectronicContractPartyStatus,
  ElectronicContractProvider,
  ElectronicContractStatus,
  PropertyListingType,
  PropertyTransactionType,
  VisitReservationStatus,
} from '../generated/prisma/client';
import type { ContractProviderService } from './contract-provider.service';
import { ElectronicContractService } from './electronic-contract.service';

const memberId = '019c75df-0255-7000-8000-000000000711';
const registrantId = '019c75df-0255-7000-8000-000000000712';
const reservationId = '019c75df-0255-7000-8000-000000000713';
const contractId = '019c75df-0255-7000-8000-000000000714';
const now = new Date('2026-07-26T06:00:00.000Z');

const reservation = {
  id: reservationId,
  reservationNumber: 'VR-2026-CONTRACT',
  requesterId: memberId,
  brokerUserId: registrantId,
  status: VisitReservationStatus.CONFIRMED,
  property: {
    id: '019c75df-0255-7000-8000-000000000715',
    listingNumber: 'LH-2026-CONTRACT',
    title: '전자계약 매물',
  },
  requester: { id: memberId, phoneVerifiedAt: now },
  broker: { id: registrantId, phoneVerifiedAt: now },
};

const contract = {
  id: contractId,
  contractNumber: 'EC-2026-CONTRACT',
  reservationId,
  propertyId: reservation.property.id,
  memberUserId: memberId,
  registrantUserId: registrantId,
  createdByUserId: memberId,
  provider: ElectronicContractProvider.MODOOSIGN,
  providerContractId: null,
  status: ElectronicContractStatus.DRAFT,
  termsVersion: '2026-07-v1',
  termsSnapshot: {},
  signedDocumentReferenceEncrypted: null,
  signedDocumentReferenceHash: null,
  signedDocumentHash: null,
  signingExpiresAt: null,
  signedAt: null,
  retainedUntil: new Date('2036-07-26T06:00:00.000Z'),
  failureCode: null,
  createdAt: now,
  updatedAt: now,
  property: {
    ...reservation.property,
    listingType: PropertyListingType.BROKERAGE,
    transactionType: PropertyTransactionType.JEONSE,
    city: '서울',
  },
  reservation: {
    id: reservationId,
    reservationNumber: reservation.reservationNumber,
    status: VisitReservationStatus.CONFIRMED,
  },
  parties: [
    {
      id: '019c75df-0255-7000-8000-000000000716',
      contractId,
      userId: memberId,
      role: ElectronicContractPartyRole.MEMBER,
      status: ElectronicContractPartyStatus.PENDING,
      viewedAt: null,
      signedAt: null,
      declinedAt: null,
      createdAt: now,
      updatedAt: now,
      user: {
        memberNumber: 'LH-MEMBER',
        profile: { displayName: '회원' },
      },
    },
    {
      id: '019c75df-0255-7000-8000-000000000717',
      contractId,
      userId: registrantId,
      role: ElectronicContractPartyRole.REGISTRANT,
      status: ElectronicContractPartyStatus.PENDING,
      viewedAt: null,
      signedAt: null,
      declinedAt: null,
      createdAt: now,
      updatedAt: now,
      user: {
        memberNumber: 'LH-REGISTRANT',
        profile: { displayName: '등록자' },
      },
    },
  ],
};

const dto = {
  provider: ElectronicContractProvider.MODOOSIGN,
  termsVersion: '2026-07-v1',
  consent: {
    personalDataProvision: true,
    electronicSignature: true,
    providerTerms: true,
  },
};

describe('ElectronicContractService', () => {
  it('requires all contract consents before reading reservation data', async () => {
    const findFirst = vi.fn();
    const prisma = {
      visitReservation: { findFirst },
    } as unknown as PrismaService;
    const provider = {} as ContractProviderService;

    await expect(
      new ElectronicContractService(prisma, provider).create(
        memberId,
        reservationId,
        {
          ...dto,
          consent: { ...dto.consent, providerTerms: false },
        },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('requires both parties to have verified phones', async () => {
    const prisma = {
      visitReservation: {
        findFirst: vi.fn(async () => ({
          ...reservation,
          broker: { id: registrantId, phoneVerifiedAt: null },
        })),
      },
    } as unknown as PrismaService;

    await expect(
      new ElectronicContractService(
        prisma,
        {} as ContractProviderService,
      ).create(memberId, reservationId, dto),
    ).rejects.toThrow(ForbiddenException);
  });

  it('hides a contract from users who are not parties', async () => {
    const prisma = {
      electronicContract: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;

    await expect(
      new ElectronicContractService(
        prisma,
        {} as ContractProviderService,
      ).get('019c75df-0255-7000-8000-000000000799', contractId),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns the existing reservation contract without duplicating it', async () => {
    const transaction = vi.fn();
    const prisma = {
      visitReservation: { findFirst: vi.fn(async () => reservation) },
      electronicContract: {
        findUnique: vi.fn(async () => contract),
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const result = await new ElectronicContractService(
      prisma,
      {} as ContractProviderService,
    ).create(memberId, reservationId, dto);

    expect(result.alreadyExists).toBe(true);
    expect(result.signingUrl).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates both parties and starts an idempotent provider session', async () => {
    const tx = {
      electronicContract: {
        create: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({
          ...contract,
          status: ElectronicContractStatus.SIGNING_PENDING,
          providerContractId: 'provider-contract-1',
          signingExpiresAt: new Date('2026-07-29T06:00:00.000Z'),
        })),
      },
      electronicContractHistory: { create: vi.fn(async () => ({})) },
      notificationOutbox: { createMany: vi.fn(async () => ({ count: 2 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      visitReservation: { findFirst: vi.fn(async () => reservation) },
      electronicContract: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => contract),
      },
      $transaction: vi.fn(
        async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx),
      ),
    } as unknown as PrismaService;
    const provider = {
      createSigningSession: vi.fn(async () => ({
        providerContractId: 'provider-contract-1',
        signingUrl: 'https://provider.example/sign/1',
        expiresAt: new Date('2026-07-29T06:00:00.000Z'),
      })),
    } as unknown as ContractProviderService;

    const result = await new ElectronicContractService(
      prisma,
      provider,
    ).create(memberId, reservationId, dto);

    const create = tx.electronicContract.create.mock.calls[0]?.[0];
    expect(create?.data.parties.create).toHaveLength(2);
    expect(provider.createSigningSession).toHaveBeenCalledWith(
      expect.objectContaining({ contractId, provider: dto.provider }),
    );
    expect(result.signingUrl).toBe('https://provider.example/sign/1');
    expect(result.contract.status).toBe(
      ElectronicContractStatus.SIGNING_PENDING,
    );
  });

  it('allows only one concurrent signing-session starter to claim a contract', async () => {
    const tx = {
      electronicContract: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      electronicContractHistory: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      electronicContract: {
        findFirst: vi.fn(async () => contract),
      },
      $transaction: vi.fn(
        async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx),
      ),
    } as unknown as PrismaService;
    const provider = {
      createSigningSession: vi.fn(),
    } as unknown as ContractProviderService;

    await expect(
      new ElectronicContractService(prisma, provider).startSigning(
        memberId,
        contractId,
      ),
    ).rejects.toThrow(ConflictException);
    expect(provider.createSigningSession).not.toHaveBeenCalled();
    expect(tx.electronicContractHistory.create).not.toHaveBeenCalled();
  });
});
