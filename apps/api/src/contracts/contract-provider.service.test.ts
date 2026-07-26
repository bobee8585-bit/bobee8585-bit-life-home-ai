import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ElectronicContractProvider } from '../generated/prisma/client';
import { ContractProviderService } from './contract-provider.service';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('ContractProviderService', () => {
  it('refuses the mock provider in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CONTRACT_PROVIDER_MODE = 'mock';

    await expect(
      new ContractProviderService().createSigningSession({
        contractId: '019c75df-0255-7000-8000-000000000701',
        contractNumber: 'EC-2026-TEST',
        provider: ElectronicContractProvider.MODOOSIGN,
        requestedByRole: 'MEMBER',
        property: {
          id: '019c75df-0255-7000-8000-000000000702',
          listingNumber: 'LH-CONTRACT',
          title: '전자계약 테스트 매물',
        },
        parties: [],
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('verifies an HMAC signature against the exact raw body', () => {
    process.env.CONTRACT_WEBHOOK_SECRET = 'contract-webhook-test-secret';
    const body = {
      providerContractId: 'provider-contract-1',
      eventType: 'contract.signed',
      status: 'SIGNED',
      documentReference: 'private-document-reference',
      documentHash: 'a'.repeat(64),
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac(
      'sha256',
      process.env.CONTRACT_WEBHOOK_SECRET,
    )
      .update(rawBody)
      .digest('hex')}`;

    expect(
      new ContractProviderService().verifyWebhook(
        rawBody,
        signature,
        body,
      ),
    ).toMatchObject({
      providerContractId: 'provider-contract-1',
      status: 'SIGNED',
    });
  });

  it('rejects a signature made for different bytes', () => {
    process.env.CONTRACT_WEBHOOK_SECRET = 'contract-webhook-test-secret';
    const rawBody = Buffer.from(
      JSON.stringify({
        providerContractId: 'provider-contract-1',
        eventType: 'contract.signed',
        status: 'SIGNED',
      }),
    );
    const signature = `sha256=${createHmac(
      'sha256',
      process.env.CONTRACT_WEBHOOK_SECRET,
    )
      .update(Buffer.from('changed'))
      .digest('hex')}`;

    expect(() =>
      new ContractProviderService().verifyWebhook(
        rawBody,
        signature,
        JSON.parse(rawBody.toString()),
      ),
    ).toThrow(UnauthorizedException);
  });
});
