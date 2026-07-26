import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GuaranteeEligibility } from '../generated/prisma/client';

export type ContractSafetyRecheckInput = {
  recheckId: string;
  contractId: string;
  contractNumber: string;
  memberUserReference: string;
  property: {
    id: string;
    listingNumber: string;
    transactionType: string;
    price: string;
    currency: string;
    countryCode: string;
    addressLine1: string;
    addressLine2: string | null;
  };
};

export type ContractSafetyProviderResult = {
  registry: {
    decision: 'CLEAR' | 'REVIEW_REQUIRED' | 'BLOCKED';
    ownerMatched: boolean;
    riskCodes: string[];
    issuedAt: Date;
    checkedAt: Date;
    provider: string;
    reference: string;
  };
  guarantee: {
    eligibility: GuaranteeEligibility;
    reasonCodes: string[];
    checkedAt: Date;
    provider: string;
    reference: string;
  };
};

@Injectable()
export class ContractSafetyProviderService {
  async recheck(
    input: ContractSafetyRecheckInput,
  ): Promise<ContractSafetyProviderResult> {
    if (this.mode() === 'MOCK') {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          '운영 환경에서는 모의 계약 안전 재확인 공급자를 사용할 수 없습니다.',
        );
      }
      const now = new Date();
      return {
        registry: {
          decision: 'CLEAR',
          ownerMatched: true,
          riskCodes: [],
          issuedAt: now,
          checkedAt: now,
          provider: 'MOCK_REGISTRY',
          reference: `registry-${input.recheckId}`,
        },
        guarantee: {
          eligibility: GuaranteeEligibility.ELIGIBLE,
          reasonCodes: [],
          checkedAt: now,
          provider: 'MOCK_GUARANTEE',
          reference: `guarantee-${input.recheckId}`,
        },
      };
    }

    const apiKey = process.env.PROPERTY_SAFETY_GATEWAY_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        '계약 안전 재확인 공급자 인증 설정이 없습니다.',
      );
    }
    const timeout = Number(
      process.env.PROPERTY_SAFETY_PROVIDER_TIMEOUT_MS ?? 10_000,
    );
    let response: Response;
    try {
      response = await fetch(
        `${this.gatewayBaseUrl()}/v1/contract-safety/rechecks`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': input.recheckId,
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeout),
        },
      );
    } catch {
      throw new BadGatewayException(
        '계약 안전 재확인 공급자에 연결하지 못했습니다.',
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `계약 안전 재확인 공급자가 요청을 거부했습니다. (${response.status})`,
      );
    }
    return this.result(await response.json());
  }

  private result(value: unknown): ContractSafetyProviderResult {
    const body = this.object(value);
    const registry = this.object(body.registry);
    const guarantee = this.object(body.guarantee);
    const decision = this.string(registry.decision);
    const ownerMatched = registry.ownerMatched;
    const issuedAt = this.date(registry.issuedAt);
    const registryCheckedAt = this.date(registry.checkedAt);
    const registryProvider = this.string(registry.provider);
    const registryReference = this.string(registry.reference);
    const eligibility = this.string(guarantee.eligibility);
    const guaranteeCheckedAt = this.date(guarantee.checkedAt);
    const guaranteeProvider = this.string(guarantee.provider);
    const guaranteeReference = this.string(guarantee.reference);

    if (
      !['CLEAR', 'REVIEW_REQUIRED', 'BLOCKED'].includes(decision ?? '') ||
      typeof ownerMatched !== 'boolean' ||
      !issuedAt ||
      !registryCheckedAt ||
      !registryProvider ||
      !registryReference ||
      !Object.values(GuaranteeEligibility).includes(
        eligibility as GuaranteeEligibility,
      ) ||
      !guaranteeCheckedAt ||
      !guaranteeProvider ||
      !guaranteeReference
    ) {
      throw new BadGatewayException(
        '계약 안전 재확인 공급자 응답 형식이 올바르지 않습니다.',
      );
    }

    return {
      registry: {
        decision: decision as ContractSafetyProviderResult['registry']['decision'],
        ownerMatched,
        riskCodes: this.strings(registry.riskCodes),
        issuedAt,
        checkedAt: registryCheckedAt,
        provider: registryProvider,
        reference: registryReference,
      },
      guarantee: {
        eligibility: eligibility as GuaranteeEligibility,
        reasonCodes: this.strings(guarantee.reasonCodes),
        checkedAt: guaranteeCheckedAt,
        provider: guaranteeProvider,
        reference: guaranteeReference,
      },
    };
  }

  private mode(): 'MOCK' | 'GATEWAY' {
    return process.env.PROPERTY_SAFETY_PROVIDER_MODE?.trim().toUpperCase() ===
      'GATEWAY'
      ? 'GATEWAY'
      : 'MOCK';
  }

  private gatewayBaseUrl(): string {
    const value =
      process.env.PROPERTY_SAFETY_GATEWAY_BASE_URL?.replace(/\/$/, '');
    if (
      !value ||
      (process.env.NODE_ENV === 'production' &&
        !value.startsWith('https://'))
    ) {
      throw new ServiceUnavailableException(
        '계약 안전 재확인 공급자 게이트웨이 주소가 올바르지 않습니다.',
      );
    }
    return value;
  }

  private object(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }

  private string(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private strings(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((item) => !this.string(item))) {
      throw new BadGatewayException(
        '계약 안전 재확인 공급자 응답 코드가 올바르지 않습니다.',
      );
    }
    return [...new Set(value.map((item) => this.string(item)!))];
  }

  private date(value: unknown): Date | undefined {
    const text = this.string(value);
    const date = new Date(text ?? '');
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
