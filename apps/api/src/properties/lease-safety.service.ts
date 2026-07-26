import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  GuaranteeEligibility,
  LeaseSafetyAssessmentStatus,
  LeaseSafetyGrade,
  Prisma,
  PropertyStatus,
  PropertyTransactionType,
} from '../generated/prisma/client';
import { createId } from '../common/id';
import {
  CreateLeaseSafetyAssessmentDto,
  RegistryRiskCode,
} from './dto/create-lease-safety-assessment.dto';

const CALCULATION_VERSION = 'LEASE_SAFETY_V1';
const REGISTRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const VALUATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const registryDeductions: Record<RegistryRiskCode, number> = {
  [RegistryRiskCode.MORTGAGE]: 10,
  [RegistryRiskCode.SEIZURE]: 25,
  [RegistryRiskCode.PROVISIONAL_SEIZURE]: 20,
  [RegistryRiskCode.AUCTION]: 40,
  [RegistryRiskCode.TRUST]: 20,
  [RegistryRiskCode.LEASEHOLD]: 10,
  [RegistryRiskCode.OTHER]: 10,
};

type Deduction = {
  code: string;
  points: number;
  message: string;
};

@Injectable()
export class LeaseSafetyService {
  constructor(private readonly prisma: PrismaService) {}

  async assess(
    propertyId: string,
    analystUserId: string,
    dto: CreateLeaseSafetyAssessmentDto,
    now = new Date(),
  ) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        listingNumber: true,
        title: true,
        transactionType: true,
        currency: true,
        price: true,
        status: true,
      },
    });
    if (!property) {
      throw new NotFoundException('매물을 찾을 수 없습니다.');
    }
    if (
      property.transactionType !== PropertyTransactionType.JEONSE ||
      property.currency !== 'KRW'
    ) {
      throw new BadRequestException(
        '전세 안전점수는 원화 전세 매물만 분석할 수 있습니다.',
      );
    }

    const marketValue = this.amount(dto.estimatedMarketValue, '추정 시세');
    const seniorClaims = this.amount(dto.seniorClaimAmount, '선순위 채권', true);
    const registryIssuedAt = this.date(dto.registryIssuedAt, '등기 발급 시각', now);
    const valuationAssessedAt = this.date(
      dto.valuationAssessedAt,
      '시세 산정 시각',
      now,
    );
    const missingInputs = [
      marketValue === null ? 'ESTIMATED_MARKET_VALUE' : null,
      seniorClaims === null ? 'SENIOR_CLAIM_AMOUNT' : null,
      dto.ownerMatched === undefined ? 'OWNER_MATCHED' : null,
      dto.guaranteeEligibility === GuaranteeEligibility.UNKNOWN
        ? 'GUARANTEE_ELIGIBILITY'
        : null,
      registryIssuedAt === null ? 'REGISTRY_ISSUED_AT' : null,
      valuationAssessedAt === null ? 'VALUATION_ASSESSED_AT' : null,
      dto.registrySource ? null : 'REGISTRY_SOURCE',
      dto.valuationSource ? null : 'VALUATION_SOURCE',
    ].filter((value): value is string => value !== null);

    const deposit = Number(property.price);
    const jeonseRatio =
      marketValue === null ? null : this.ratio(deposit, marketValue);
    const totalExposureRatio =
      marketValue === null || seniorClaims === null
        ? null
        : this.ratio(deposit + seniorClaims, marketValue);
    const deductions =
      missingInputs.length === 0
        ? this.deductions(
            jeonseRatio!,
            totalExposureRatio!,
            dto.registryRiskCodes,
            dto.ownerMatched!,
            dto.guaranteeEligibility,
          )
        : [];
    const score =
      missingInputs.length === 0
        ? Math.max(
            0,
            100 - deductions.reduce((sum, item) => sum + item.points, 0),
          )
        : null;
    const status =
      score === null
        ? LeaseSafetyAssessmentStatus.INCOMPLETE
        : LeaseSafetyAssessmentStatus.READY;
    const grade = score === null ? LeaseSafetyGrade.UNAVAILABLE : this.grade(score);

    const created = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.leaseSafetyAssessment.findFirst({
        where: { propertyId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const assessment = await tx.leaseSafetyAssessment.create({
        data: {
          id: createId(),
          propertyId,
          analystUserId,
          version: (latest?.version ?? 0) + 1,
          status,
          score,
          grade,
          estimatedMarketValue: marketValue,
          seniorClaimAmount: seniorClaims,
          jeonseRatio,
          totalExposureRatio,
          ownerMatched: dto.ownerMatched,
          guaranteeEligibility: dto.guaranteeEligibility,
          registryRiskCodes: [...new Set(dto.registryRiskCodes)],
          registryIssuedAt,
          valuationAssessedAt,
          registrySource: dto.registrySource?.trim(),
          valuationSource: dto.valuationSource?.trim(),
          evidenceReferenceHash: dto.evidenceReference
            ? createHash('sha256').update(dto.evidenceReference).digest('hex')
            : null,
          missingInputs,
          deductionBreakdown: deductions as unknown as Prisma.InputJsonValue,
          calculationVersion: CALCULATION_VERSION,
          assessedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          actorId: analystUserId,
          action: 'LEASE_SAFETY_ASSESSMENT_CREATED',
          targetType: 'PROPERTY',
          targetId: propertyId,
          afterData: {
            assessmentId: assessment.id,
            version: assessment.version,
            status,
            score,
            grade,
            calculationVersion: CALCULATION_VERSION,
          },
          succeeded: true,
        },
      });
      return assessment;
    });
    return this.present(property, created, now);
  }

  async latest(propertyId: string, now = new Date()) {
    const property = await this.prisma.property.findFirst({
      where: {
        id: propertyId,
        status: PropertyStatus.ACTIVE,
        transactionType: PropertyTransactionType.JEONSE,
      },
      select: {
        id: true,
        listingNumber: true,
        title: true,
        transactionType: true,
        currency: true,
        price: true,
        status: true,
      },
    });
    if (!property) {
      throw new NotFoundException('공개된 전세 매물을 찾을 수 없습니다.');
    }
    const assessment = await this.prisma.leaseSafetyAssessment.findFirst({
      where: { propertyId },
      orderBy: { version: 'desc' },
    });
    if (!assessment) {
      return {
        property: this.propertySummary(property),
        availability: 'NOT_ASSESSED',
        score: null,
        grade: LeaseSafetyGrade.UNAVAILABLE,
        disclaimer:
          '안전점수는 참고 정보이며 보증금 회수를 보장하거나 법률 판단을 대신하지 않습니다.',
      };
    }
    return this.present(property, assessment, now);
  }

  private present(property: any, assessment: any, now: Date) {
    const registryStale =
      !assessment.registryIssuedAt ||
      now.getTime() - new Date(assessment.registryIssuedAt).getTime() >
        REGISTRY_MAX_AGE_MS;
    const valuationStale =
      !assessment.valuationAssessedAt ||
      now.getTime() - new Date(assessment.valuationAssessedAt).getTime() >
        VALUATION_MAX_AGE_MS;
    const isStale = registryStale || valuationStale;
    return {
      property: this.propertySummary(property),
      availability:
        assessment.status === LeaseSafetyAssessmentStatus.INCOMPLETE
          ? 'INCOMPLETE'
          : isStale
            ? 'STALE'
            : 'READY',
      assessmentId: assessment.id,
      version: assessment.version,
      score: assessment.score,
      grade: assessment.grade,
      ratios: {
        jeonse: this.percent(assessment.jeonseRatio),
        totalExposure: this.percent(assessment.totalExposureRatio),
      },
      inputs: {
        estimatedMarketValue:
          assessment.estimatedMarketValue?.toString() ?? null,
        seniorClaimAmount: assessment.seniorClaimAmount?.toString() ?? null,
        ownerMatched: assessment.ownerMatched,
        guaranteeEligibility: assessment.guaranteeEligibility,
        registryRiskCodes: assessment.registryRiskCodes,
      },
      evidence: {
        registrySource: assessment.registrySource,
        registryIssuedAt: assessment.registryIssuedAt?.toISOString() ?? null,
        registryFresh: !registryStale,
        valuationSource: assessment.valuationSource,
        valuationAssessedAt:
          assessment.valuationAssessedAt?.toISOString() ?? null,
        valuationFresh: !valuationStale,
      },
      missingInputs: assessment.missingInputs,
      deductions: assessment.deductionBreakdown,
      calculationVersion: assessment.calculationVersion,
      assessedAt: assessment.assessedAt.toISOString(),
      needsContractRecheck: isStale || assessment.status !== 'READY',
      disclaimer:
        '안전점수는 참고 정보이며 보증금 회수를 보장하거나 법률 판단을 대신하지 않습니다. 계약 직전 최신 등기와 보증 가입 가능 여부를 다시 확인하세요.',
    };
  }

  private deductions(
    jeonseRatio: number,
    totalExposureRatio: number,
    risks: RegistryRiskCode[],
    ownerMatched: boolean,
    guarantee: GuaranteeEligibility,
  ): Deduction[] {
    const result: Deduction[] = [];
    const jeonsePoints =
      jeonseRatio > 0.9 ? 55 : jeonseRatio > 0.8 ? 40 : jeonseRatio > 0.7 ? 25 : jeonseRatio > 0.6 ? 10 : 0;
    if (jeonsePoints) {
      result.push({
        code: 'JEONSE_RATIO',
        points: jeonsePoints,
        message: '추정 시세 대비 전세보증금 비율이 높습니다.',
      });
    }
    const exposurePoints =
      totalExposureRatio > 0.9
        ? 35
        : totalExposureRatio > 0.8
          ? 20
          : totalExposureRatio > 0.7
            ? 10
            : 0;
    if (exposurePoints) {
      result.push({
        code: 'TOTAL_EXPOSURE_RATIO',
        points: exposurePoints,
        message: '보증금과 선순위 채권의 합계 비율이 높습니다.',
      });
    }
    const uniqueRisks = [...new Set(risks)];
    const registryPoints = Math.min(
      50,
      uniqueRisks.reduce((sum, risk) => sum + registryDeductions[risk], 0),
    );
    if (registryPoints) {
      result.push({
        code: 'REGISTRY_RISKS',
        points: registryPoints,
        message: `등기 위험 항목이 확인됐습니다: ${uniqueRisks.join(', ')}`,
      });
    }
    if (!ownerMatched) {
      result.push({
        code: 'OWNER_MISMATCH',
        points: 25,
        message: '매물 등록 정보와 등기상 소유자가 일치하지 않습니다.',
      });
    }
    if (guarantee === GuaranteeEligibility.INELIGIBLE) {
      result.push({
        code: 'GUARANTEE_INELIGIBLE',
        points: 20,
        message: '입력 근거 기준으로 보증보험 가입이 어렵습니다.',
      });
    }
    return result;
  }

  private grade(score: number): LeaseSafetyGrade {
    if (score >= 85) return LeaseSafetyGrade.VERY_SAFE;
    if (score >= 70) return LeaseSafetyGrade.SAFE;
    if (score >= 50) return LeaseSafetyGrade.CAUTION;
    if (score >= 30) return LeaseSafetyGrade.HIGH_RISK;
    return LeaseSafetyGrade.CRITICAL;
  }

  private amount(value: string | undefined, label: string, allowZero = false) {
    if (value === undefined) return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0)) {
      throw new BadRequestException(`${label} 금액이 올바르지 않습니다.`);
    }
    return amount;
  }

  private date(value: string | undefined, label: string, now: Date) {
    if (!value) return null;
    const date = new Date(value);
    if (date.getTime() > now.getTime() + 5 * 60 * 1_000) {
      throw new BadRequestException(`${label}은 미래일 수 없습니다.`);
    }
    return date;
  }

  private ratio(numerator: number, denominator: number) {
    return Math.round((numerator / denominator) * 10_000) / 10_000;
  }

  private percent(value: unknown) {
    return value === null || value === undefined
      ? null
      : Math.round(Number(value) * 10_000) / 100;
  }

  private propertySummary(property: any) {
    return {
      id: property.id,
      listingNumber: property.listingNumber,
      title: property.title,
      transactionType: property.transactionType,
      deposit: property.price.toString(),
      currency: property.currency,
    };
  }
}
