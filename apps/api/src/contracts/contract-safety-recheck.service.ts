import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  ContractSafetyRecheckStatus,
  ElectronicContractStatus,
  GuaranteeEligibility,
  Prisma,
  PropertyTransactionType,
} from '../generated/prisma/client';
import { ContractSafetyProviderService } from './contract-safety-provider.service';

const RECHECK_VALID_MS = 30 * 60 * 1_000;
const RUNNING_TIMEOUT_MS = 2 * 60 * 1_000;
const REGISTRY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 5 * 60 * 1_000;
const criticalRegistryRisks = new Set([
  'AUCTION',
  'SEIZURE',
  'PROVISIONAL_SEIZURE',
  'TRUST',
]);

const recheckContractSelect = {
  id: true,
  contractNumber: true,
  status: true,
  memberUserId: true,
  registrantUserId: true,
  property: {
    select: {
      id: true,
      listingNumber: true,
      transactionType: true,
      price: true,
      currency: true,
      countryCode: true,
      addressLine1: true,
      addressLine2: true,
    },
  },
} as const;

@Injectable()
export class ContractSafetyRecheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ContractSafetyProviderService,
  ) {}

  async run(
    userId: string,
    contractId: string,
    options: { force?: boolean; now?: Date } = {},
  ) {
    const now = options.now ?? new Date();
    const contract = await this.participantContract(contractId, userId);
    if (
      contract.property.transactionType !== PropertyTransactionType.JEONSE
    ) {
      return {
        required: false,
        reason: 'ONLY_JEONSE_REQUIRES_GUARANTEE_RECHECK',
        recheck: null,
      };
    }
    if (
      contract.property.countryCode !== 'KR' ||
      contract.property.currency !== 'KRW'
    ) {
      throw new UnprocessableEntityException(
        '현재 계약 안전 재확인은 국내 원화 전세 계약만 지원합니다.',
      );
    }
    if (
      contract.status !== ElectronicContractStatus.DRAFT &&
      contract.status !== ElectronicContractStatus.FAILED
    ) {
      throw new ConflictException(
        '현재 계약 상태에서는 안전 재확인을 실행할 수 없습니다.',
      );
    }

    const existing = await this.prisma.contractSafetyRecheck.findFirst({
      where: { contractId },
      orderBy: { attempt: 'desc' },
    });
    if (
      !options.force &&
      existing?.status === ContractSafetyRecheckStatus.PASSED &&
      existing.expiresAt &&
      existing.expiresAt > now
    ) {
      return { required: true, reused: true, recheck: this.present(existing) };
    }
    if (
      existing?.status === ContractSafetyRecheckStatus.RUNNING &&
      now.getTime() - existing.startedAt.getTime() < RUNNING_TIMEOUT_MS
    ) {
      throw new ConflictException(
        '계약 안전 재확인이 이미 진행 중입니다.',
      );
    }

    const id = createId();
    const attempt = (existing?.attempt ?? 0) + 1;
    try {
      await this.prisma.contractSafetyRecheck.create({
        data: {
          id,
          contractId,
          requestedByUserId: userId,
          attempt,
          startedAt: now,
        },
      });
    } catch (error: unknown) {
      if (this.prismaCode(error) === 'P2002') {
        throw new ConflictException(
          '다른 요청이 계약 안전 재확인을 시작했습니다.',
        );
      }
      throw error;
    }

    try {
      const result = await this.provider.recheck({
        recheckId: id,
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        memberUserReference: contract.memberUserId,
        property: {
          ...contract.property,
          price: contract.property.price.toString(),
        },
      });
      const temporalValid = this.temporalValid(result, now);
      const criticalRisks = result.registry.riskCodes.filter((code) =>
        criticalRegistryRisks.has(code),
      );
      const passed =
        temporalValid &&
        result.registry.decision === 'CLEAR' &&
        result.registry.ownerMatched &&
        criticalRisks.length === 0 &&
        result.guarantee.eligibility === GuaranteeEligibility.ELIGIBLE;
      const status = passed
        ? ContractSafetyRecheckStatus.PASSED
        : ContractSafetyRecheckStatus.BLOCKED;
      const expiresAt = passed
        ? new Date(
            Math.min(
              now.getTime() + RECHECK_VALID_MS,
              result.registry.issuedAt.getTime() + REGISTRY_MAX_AGE_MS,
            ),
          )
        : null;
      const failureCode = passed
        ? null
        : this.blockCode(result, temporalValid, criticalRisks);

      const updated = await this.prisma.$transaction(async (tx) => {
        const recheck = await tx.contractSafetyRecheck.update({
          where: { id },
          data: {
            status,
            registryDecision: result.registry.decision,
            ownerMatched: result.registry.ownerMatched,
            registryRiskCodes: result.registry.riskCodes,
            registryIssuedAt: result.registry.issuedAt,
            registryCheckedAt: result.registry.checkedAt,
            registryProvider: result.registry.provider,
            registryReferenceHash: this.hash(result.registry.reference),
            guaranteeEligibility: result.guarantee.eligibility,
            guaranteeReasonCodes: result.guarantee.reasonCodes,
            guaranteeCheckedAt: result.guarantee.checkedAt,
            guaranteeProvider: result.guarantee.provider,
            guaranteeReferenceHash: this.hash(
              result.guarantee.reference,
            ),
            failureCode,
            resultSnapshot: {
              registry: {
                decision: result.registry.decision,
                ownerMatched: result.registry.ownerMatched,
                riskCodes: result.registry.riskCodes,
                issuedAt: result.registry.issuedAt.toISOString(),
                checkedAt: result.registry.checkedAt.toISOString(),
                provider: result.registry.provider,
              },
              guarantee: {
                eligibility: result.guarantee.eligibility,
                reasonCodes: result.guarantee.reasonCodes,
                checkedAt: result.guarantee.checkedAt.toISOString(),
                provider: result.guarantee.provider,
              },
            } as Prisma.InputJsonValue,
            completedAt: now,
            expiresAt,
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            actorId: userId,
            action: `CONTRACT_SAFETY_RECHECK.${status}`,
            targetType: 'ElectronicContract',
            targetId: contractId,
            afterData: {
              recheckId: id,
              attempt,
              status,
              registryDecision: result.registry.decision,
              guaranteeEligibility: result.guarantee.eligibility,
              failureCode,
              expiresAt: expiresAt?.toISOString() ?? null,
            },
          },
        });
        if (!passed) {
          await tx.notificationOutbox.createMany({
            data: [
              contract.memberUserId,
              contract.registrantUserId,
            ].map((recipientUserId) => ({
              id: createId(),
              recipientUserId,
              type: 'CONTRACT_SAFETY_RECHECK_BLOCKED',
              aggregateType: 'ElectronicContract',
              aggregateId: contractId,
              payload: {
                contractId,
                contractNumber: contract.contractNumber,
                listingNumber: contract.property.listingNumber,
                recheckId: id,
                failureCode,
              },
              smsFallbackAllowed: false,
            })),
          });
        }
        return recheck;
      });
      return {
        required: true,
        reused: false,
        recheck: this.present(updated),
      };
    } catch (error: unknown) {
      if (
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException
      ) {
        throw error;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.contractSafetyRecheck.update({
          where: { id },
          data: {
            status: ContractSafetyRecheckStatus.FAILED,
            failureCode: 'PROVIDER_RECHECK_FAILED',
            completedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            actorId: userId,
            action: 'CONTRACT_SAFETY_RECHECK.FAILED',
            targetType: 'ElectronicContract',
            targetId: contractId,
            afterData: {
              recheckId: id,
              attempt,
              status: ContractSafetyRecheckStatus.FAILED,
              failureCode: 'PROVIDER_RECHECK_FAILED',
            },
            succeeded: false,
          },
        });
      });
      throw new ServiceUnavailableException(
        '최신 등기와 보증가입 가능 여부를 확인하지 못했습니다. 서명을 시작하지 않았습니다.',
      );
    }
  }

  async ensurePassedForSigning(userId: string, contractId: string) {
    const result = await this.run(userId, contractId);
    if (
      result.required &&
      result.recheck?.status !== ContractSafetyRecheckStatus.PASSED
    ) {
      throw new UnprocessableEntityException({
        message:
          '계약 안전 재확인에서 위험 또는 보증가입 제한이 확인되어 서명을 시작할 수 없습니다.',
        recheck: result.recheck,
      });
    }
    return result;
  }

  async latest(userId: string, contractId: string) {
    const contract = await this.participantContract(contractId, userId);
    if (
      contract.property.transactionType !== PropertyTransactionType.JEONSE
    ) {
      return {
        required: false,
        reason: 'ONLY_JEONSE_REQUIRES_GUARANTEE_RECHECK',
        recheck: null,
      };
    }
    const recheck = await this.prisma.contractSafetyRecheck.findFirst({
      where: { contractId },
      orderBy: { attempt: 'desc' },
    });
    return {
      required: true,
      recheck: recheck ? this.present(recheck) : null,
    };
  }

  private async participantContract(contractId: string, userId: string) {
    const contract = await this.prisma.electronicContract.findFirst({
      where: {
        id: contractId,
        OR: [{ memberUserId: userId }, { registrantUserId: userId }],
      },
      select: recheckContractSelect,
    });
    if (!contract) {
      throw new NotFoundException('전자계약을 찾을 수 없습니다.');
    }
    return contract;
  }

  private temporalValid(
    result: Awaited<ReturnType<ContractSafetyProviderService['recheck']>>,
    now: Date,
  ): boolean {
    const dates = [
      result.registry.issuedAt,
      result.registry.checkedAt,
      result.guarantee.checkedAt,
    ];
    return (
      dates.every((date) => date.getTime() <= now.getTime() + CLOCK_SKEW_MS) &&
      now.getTime() - result.registry.issuedAt.getTime() <=
        REGISTRY_MAX_AGE_MS &&
      now.getTime() - result.registry.checkedAt.getTime() <=
        RECHECK_VALID_MS &&
      now.getTime() - result.guarantee.checkedAt.getTime() <=
        RECHECK_VALID_MS
    );
  }

  private blockCode(
    result: Awaited<ReturnType<ContractSafetyProviderService['recheck']>>,
    temporalValid: boolean,
    criticalRisks: string[],
  ): string {
    if (!temporalValid) return 'STALE_OR_FUTURE_PROVIDER_EVIDENCE';
    if (!result.registry.ownerMatched) return 'OWNER_MISMATCH';
    if (criticalRisks.length > 0) return 'CRITICAL_REGISTRY_RISK';
    if (result.registry.decision !== 'CLEAR') {
      return 'REGISTRY_REVIEW_REQUIRED';
    }
    if (
      result.guarantee.eligibility !== GuaranteeEligibility.ELIGIBLE
    ) {
      return 'GUARANTEE_NOT_ELIGIBLE';
    }
    return 'SAFETY_RECHECK_BLOCKED';
  }

  private present(recheck: {
    id: string;
    attempt: number;
    status: ContractSafetyRecheckStatus;
    registryDecision: string | null;
    ownerMatched: boolean | null;
    registryRiskCodes: string[];
    registryIssuedAt: Date | null;
    registryCheckedAt: Date | null;
    registryProvider: string | null;
    guaranteeEligibility: GuaranteeEligibility;
    guaranteeReasonCodes: string[];
    guaranteeCheckedAt: Date | null;
    guaranteeProvider: string | null;
    failureCode: string | null;
    startedAt: Date;
    completedAt: Date | null;
    expiresAt: Date | null;
  }) {
    return {
      id: recheck.id,
      attempt: recheck.attempt,
      status: recheck.status,
      registry: {
        decision: recheck.registryDecision,
        ownerMatched: recheck.ownerMatched,
        riskCodes: recheck.registryRiskCodes,
        issuedAt: recheck.registryIssuedAt?.toISOString() ?? null,
        checkedAt: recheck.registryCheckedAt?.toISOString() ?? null,
        provider: recheck.registryProvider,
      },
      guarantee: {
        eligibility: recheck.guaranteeEligibility,
        reasonCodes: recheck.guaranteeReasonCodes,
        checkedAt: recheck.guaranteeCheckedAt?.toISOString() ?? null,
        provider: recheck.guaranteeProvider,
      },
      failureCode: recheck.failureCode,
      startedAt: recheck.startedAt.toISOString(),
      completedAt: recheck.completedAt?.toISOString() ?? null,
      expiresAt: recheck.expiresAt?.toISOString() ?? null,
      disclaimer:
        '재확인 결과는 공급자 조회 시점의 참고 정보이며 법률 판단이나 보증 가입 승인을 대신하지 않습니다.',
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private prismaCode(error: unknown): string | undefined {
    return typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
      ? error.code
      : undefined;
  }
}
