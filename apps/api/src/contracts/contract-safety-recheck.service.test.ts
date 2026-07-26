import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  ContractSafetyRecheckStatus,
  ElectronicContractStatus,
  GuaranteeEligibility,
  PropertyTransactionType,
} from '../generated/prisma/client';
import type { ContractSafetyProviderService } from './contract-safety-provider.service';
import { ContractSafetyRecheckService } from './contract-safety-recheck.service';

const now = new Date('2026-07-27T03:00:00.000Z');
const contractId = '019c75df-0255-7000-8000-000000000811';
const memberId = '019c75df-0255-7000-8000-000000000812';
const registrantId = '019c75df-0255-7000-8000-000000000813';
const contract = {
  id: contractId,
  contractNumber: 'EC-2026-SAFETY',
  status: ElectronicContractStatus.DRAFT,
  memberUserId: memberId,
  registrantUserId: registrantId,
  property: {
    id: '019c75df-0255-7000-8000-000000000814',
    listingNumber: 'LH-SAFETY',
    transactionType: PropertyTransactionType.JEONSE,
    price: { toString: () => '500000000' },
    currency: 'KRW',
    countryCode: 'KR',
    addressLine1: '서울시 테스트구',
    addressLine2: null,
  },
};
const providerResult = {
  registry: {
    decision: 'CLEAR' as const,
    ownerMatched: true,
    riskCodes: [],
    issuedAt: new Date('2026-07-27T02:59:00.000Z'),
    checkedAt: new Date('2026-07-27T03:00:00.000Z'),
    provider: 'REGISTRY_GATEWAY',
    reference: 'private-registry-reference',
  },
  guarantee: {
    eligibility: GuaranteeEligibility.ELIGIBLE,
    reasonCodes: [],
    checkedAt: new Date('2026-07-27T03:00:00.000Z'),
    provider: 'GUARANTEE_GATEWAY',
    reference: 'private-guarantee-reference',
  },
};

function completedRecheck(
  data: Record<string, unknown>,
  status: ContractSafetyRecheckStatus,
) {
  return {
    id: '019c75df-0255-7000-8000-000000000815',
    attempt: 1,
    status,
    registryDecision: providerResult.registry.decision,
    ownerMatched: providerResult.registry.ownerMatched,
    registryRiskCodes: providerResult.registry.riskCodes,
    registryIssuedAt: providerResult.registry.issuedAt,
    registryCheckedAt: providerResult.registry.checkedAt,
    registryProvider: providerResult.registry.provider,
    guaranteeEligibility: providerResult.guarantee.eligibility,
    guaranteeReasonCodes: providerResult.guarantee.reasonCodes,
    guaranteeCheckedAt: providerResult.guarantee.checkedAt,
    guaranteeProvider: providerResult.guarantee.provider,
    failureCode: data.failureCode as string | null,
    startedAt: now,
    completedAt: now,
    expiresAt: (data.expiresAt as Date | null) ?? null,
  };
}

function setup(result = providerResult) {
  const tx = {
    contractSafetyRecheck: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        completedRecheck(
          data,
          data.status as ContractSafetyRecheckStatus,
        ),
      ),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    notificationOutbox: {
      createMany: vi.fn(async () => ({ count: 2 })),
    },
  };
  const prisma = {
    electronicContract: { findFirst: vi.fn(async () => contract) },
    contractSafetyRecheck: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(
      async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
    ),
  } as unknown as PrismaService;
  const provider = {
    recheck: vi.fn(async () => result),
  } as unknown as ContractSafetyProviderService;
  return { prisma, provider, tx };
}

describe('ContractSafetyRecheckService', () => {
  it('skips the guarantee recheck for non-jeonse contracts', async () => {
    const { prisma, provider } = setup();
    (
      prisma.electronicContract.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      ...contract,
      property: {
        ...contract.property,
        transactionType: PropertyTransactionType.SALE,
      },
    });

    const result = await new ContractSafetyRecheckService(
      prisma,
      provider,
    ).run(memberId, contractId, { now });

    expect(result.required).toBe(false);
    expect(provider.recheck).not.toHaveBeenCalled();
  });

  it('persists only hashes of provider references and passes fresh evidence', async () => {
    const { prisma, provider, tx } = setup();

    const result = await new ContractSafetyRecheckService(
      prisma,
      provider,
    ).run(memberId, contractId, { now });

    const data = tx.contractSafetyRecheck.update.mock.calls[0]?.[0].data;
    expect(result.recheck?.status).toBe(
      ContractSafetyRecheckStatus.PASSED,
    );
    expect(data.registryReferenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain(
      'private-registry-reference',
    );
    expect(tx.notificationOutbox.createMany).not.toHaveBeenCalled();
  });

  it('blocks signing and notifies both parties when guarantee is ineligible', async () => {
    const { prisma, provider, tx } = setup({
      ...providerResult,
      guarantee: {
        ...providerResult.guarantee,
        eligibility: GuaranteeEligibility.INELIGIBLE,
        reasonCodes: ['LIMIT_EXCEEDED'],
      },
    });
    const service = new ContractSafetyRecheckService(prisma, provider);

    await expect(
      service.ensurePassedForSigning(memberId, contractId),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(tx.notificationOutbox.createMany).toHaveBeenCalledOnce();
    expect(
      tx.notificationOutbox.createMany.mock.calls[0]?.[0].data,
    ).toHaveLength(2);
  });

  it('fails closed when the external provider is unavailable', async () => {
    const { prisma, provider, tx } = setup();
    (provider.recheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('provider unavailable'),
    );

    await expect(
      new ContractSafetyRecheckService(prisma, provider).run(
        memberId,
        contractId,
        { now },
      ),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(tx.contractSafetyRecheck.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ContractSafetyRecheckStatus.FAILED,
          failureCode: 'PROVIDER_RECHECK_FAILED',
        }),
      }),
    );
  });

  it('reuses a still-valid passed recheck for signing retries', async () => {
    const { prisma, provider } = setup();
    const existing = completedRecheck(
      { expiresAt: new Date('2026-07-27T03:20:00.000Z') },
      ContractSafetyRecheckStatus.PASSED,
    );
    (
      prisma.contractSafetyRecheck.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue(existing);

    const result = await new ContractSafetyRecheckService(
      prisma,
      provider,
    ).run(memberId, contractId, { now });

    expect(result.reused).toBe(true);
    expect(provider.recheck).not.toHaveBeenCalled();
  });
});
