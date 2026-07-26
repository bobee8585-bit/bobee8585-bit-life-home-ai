import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuaranteeEligibility } from '../generated/prisma/client';
import { ContractSafetyProviderService } from './contract-safety-provider.service';

const originalEnvironment = { ...process.env };
const originalFetch = globalThis.fetch;
const input = {
  recheckId: '019c75df-0255-7000-8000-000000000801',
  contractId: '019c75df-0255-7000-8000-000000000802',
  contractNumber: 'EC-2026-SAFETY',
  memberUserReference: '019c75df-0255-7000-8000-000000000803',
  property: {
    id: '019c75df-0255-7000-8000-000000000804',
    listingNumber: 'LH-SAFETY',
    transactionType: 'JEONSE',
    price: '500000000',
    currency: 'KRW',
    countryCode: 'KR',
    addressLine1: '서울시 테스트구',
    addressLine2: null,
  },
};

afterEach(() => {
  process.env = { ...originalEnvironment };
  globalThis.fetch = originalFetch;
});

describe('ContractSafetyProviderService', () => {
  it('refuses mock safety checks in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PROPERTY_SAFETY_PROVIDER_MODE = 'mock';

    await expect(
      new ContractSafetyProviderService().recheck(input),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('uses a recheck idempotency key and validates the gateway result', async () => {
    process.env.PROPERTY_SAFETY_PROVIDER_MODE = 'gateway';
    process.env.PROPERTY_SAFETY_GATEWAY_BASE_URL =
      'https://safety.example';
    process.env.PROPERTY_SAFETY_GATEWAY_API_KEY = 'test-key';
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          registry: {
            decision: 'CLEAR',
            ownerMatched: true,
            riskCodes: [],
            issuedAt: '2026-07-27T00:00:00.000Z',
            checkedAt: '2026-07-27T00:01:00.000Z',
            provider: 'REGISTRY_GATEWAY',
            reference: 'private-registry-reference',
          },
          guarantee: {
            eligibility: 'ELIGIBLE',
            reasonCodes: [],
            checkedAt: '2026-07-27T00:01:00.000Z',
            provider: 'GUARANTEE_GATEWAY',
            reference: 'private-guarantee-reference',
          },
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const result = await new ContractSafetyProviderService().recheck(input);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://safety.example/v1/contract-safety/rechecks',
      expect.objectContaining({
        headers: expect.objectContaining({
          'idempotency-key': input.recheckId,
        }),
      }),
    );
    expect(result.guarantee.eligibility).toBe(
      GuaranteeEligibility.ELIGIBLE,
    );
    expect(result.registry.issuedAt).toBeInstanceOf(Date);
  });

  it('rejects incomplete gateway evidence', async () => {
    process.env.PROPERTY_SAFETY_PROVIDER_MODE = 'gateway';
    process.env.PROPERTY_SAFETY_GATEWAY_BASE_URL =
      'https://safety.example';
    process.env.PROPERTY_SAFETY_GATEWAY_API_KEY = 'test-key';
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ registry: {}, guarantee: {} }), {
        status: 200,
      }),
    ) as typeof fetch;

    await expect(
      new ContractSafetyProviderService().recheck(input),
    ).rejects.toThrow(BadGatewayException);
  });
});
