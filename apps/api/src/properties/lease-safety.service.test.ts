import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  GuaranteeEligibility,
  LeaseSafetyAssessmentStatus,
  LeaseSafetyGrade,
  PropertyStatus,
  PropertyTransactionType,
} from '../generated/prisma/client';
import {
  CreateLeaseSafetyAssessmentDto,
  RegistryRiskCode,
} from './dto/create-lease-safety-assessment.dto';
import { LeaseSafetyService } from './lease-safety.service';

const now = new Date('2026-07-27T12:00:00.000Z');
const property = {
  id: '019c75df-0255-7000-8000-000000000020',
  listingNumber: 'LH-2026-JEONSE',
  title: '전세 안전점수 테스트 매물',
  transactionType: PropertyTransactionType.JEONSE,
  currency: 'KRW',
  price: 700_000_000,
  status: PropertyStatus.ACTIVE,
};

const completeDto = (): CreateLeaseSafetyAssessmentDto => ({
  estimatedMarketValue: '1000000000',
  seniorClaimAmount: '50000000',
  ownerMatched: true,
  guaranteeEligibility: GuaranteeEligibility.ELIGIBLE,
  registryRiskCodes: [],
  registryIssuedAt: '2026-07-26T12:00:00.000Z',
  valuationAssessedAt: '2026-07-20T12:00:00.000Z',
  registrySource: '인터넷등기소',
  valuationSource: '공공 실거래가',
  evidenceReference: 'evidence://lease-safety/test',
});

function assessmentPrisma(overrides: Partial<typeof property> = {}) {
  let createdData: any;
  const tx = {
    leaseSafetyAssessment: {
      findFirst: vi.fn(async () => ({ version: 2 })),
      create: vi.fn(async ({ data }) => {
        createdData = data;
        return {
          ...data,
          id: data.id,
          createdAt: now,
        };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }) => data),
    },
  };
  const prisma = {
    property: {
      findUnique: vi.fn(async () => ({ ...property, ...overrides })),
    },
    $transaction: vi.fn(async (callback) => callback(tx)),
  } as unknown as PrismaService;
  return { prisma, tx, created: () => createdData };
}

describe('LeaseSafetyService', () => {
  it('calculates a deterministic score from ratios and registry evidence', async () => {
    const { prisma, created } = assessmentPrisma();
    const dto = completeDto();
    dto.registryRiskCodes = [RegistryRiskCode.MORTGAGE];

    const result = await new LeaseSafetyService(prisma).assess(
      property.id,
      '019c75df-0255-7000-8000-000000000001',
      dto,
      now,
    );

    expect(result.availability).toBe('READY');
    expect(result.score).toBe(70);
    expect(result.grade).toBe(LeaseSafetyGrade.SAFE);
    expect(result.ratios).toEqual({
      jeonse: 70,
      totalExposure: 75,
    });
    expect(created().version).toBe(3);
    expect(created().status).toBe(LeaseSafetyAssessmentStatus.READY);
    expect(created().evidenceReferenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not publish a numeric score when required evidence is missing', async () => {
    const { prisma } = assessmentPrisma();
    const dto = completeDto();
    delete dto.estimatedMarketValue;
    dto.guaranteeEligibility = GuaranteeEligibility.UNKNOWN;

    const result = await new LeaseSafetyService(prisma).assess(
      property.id,
      '019c75df-0255-7000-8000-000000000001',
      dto,
      now,
    );

    expect(result.availability).toBe('INCOMPLETE');
    expect(result.score).toBeNull();
    expect(result.grade).toBe(LeaseSafetyGrade.UNAVAILABLE);
    expect(result.missingInputs).toEqual(
      expect.arrayContaining([
        'ESTIMATED_MARKET_VALUE',
        'GUARANTEE_ELIGIBILITY',
      ]),
    );
  });

  it('marks old registry evidence stale and requires a contract recheck', async () => {
    const assessment = {
      id: 'assessment',
      propertyId: property.id,
      version: 1,
      status: LeaseSafetyAssessmentStatus.READY,
      score: 90,
      grade: LeaseSafetyGrade.VERY_SAFE,
      estimatedMarketValue: 1_000_000_000,
      seniorClaimAmount: 0,
      jeonseRatio: 0.7,
      totalExposureRatio: 0.7,
      ownerMatched: true,
      guaranteeEligibility: GuaranteeEligibility.ELIGIBLE,
      registryRiskCodes: [],
      registryIssuedAt: new Date('2026-07-01T00:00:00.000Z'),
      valuationAssessedAt: new Date('2026-07-20T00:00:00.000Z'),
      registrySource: '인터넷등기소',
      valuationSource: '공공 실거래가',
      missingInputs: [],
      deductionBreakdown: [],
      calculationVersion: 'LEASE_SAFETY_V1',
      assessedAt: new Date('2026-07-20T00:00:00.000Z'),
    };
    const prisma = {
      property: {
        findFirst: vi.fn(async () => property),
      },
      leaseSafetyAssessment: {
        findFirst: vi.fn(async () => assessment),
      },
    } as unknown as PrismaService;

    const result = await new LeaseSafetyService(prisma).latest(property.id, now);

    expect(result.availability).toBe('STALE');
    expect(result.needsContractRecheck).toBe(true);
    expect(result.evidence.registryFresh).toBe(false);
  });

  it('rejects non-jeonse listings', async () => {
    const { prisma } = assessmentPrisma({
      transactionType: PropertyTransactionType.SALE,
    });

    await expect(
      new LeaseSafetyService(prisma).assess(
        property.id,
        '019c75df-0255-7000-8000-000000000001',
        completeDto(),
        now,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
