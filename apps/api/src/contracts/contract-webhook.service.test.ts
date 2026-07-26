import { ConflictException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SensitiveDataService } from '../common/sensitive-data.service';
import type { PrismaService } from '../database/prisma.service';
import {
  ContractWebhookEventStatus,
  ElectronicContractPartyRole,
  ElectronicContractProvider,
  ElectronicContractStatus,
} from '../generated/prisma/client';
import { ContractProviderService } from './contract-provider.service';
import { ContractWebhookService } from './contract-webhook.service';

const originalEnvironment = { ...process.env };
const contractId = '019c75df-0255-7000-8000-000000000721';
const eventId = 'event-contract-signed';

afterEach(() => {
  process.env = { ...originalEnvironment };
});

function signedWebhook() {
  process.env.CONTRACT_WEBHOOK_SECRET = 'contract-webhook-test-secret';
  const body = {
    providerContractId: 'provider-contract-1',
    eventType: 'contract.signed',
    status: 'SIGNED',
    documentReference: 'private-provider-document-reference',
    documentHash: 'b'.repeat(64),
    occurredAt: '2026-07-26T07:00:00.000Z',
  };
  const raw = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac(
    'sha256',
    process.env.CONTRACT_WEBHOOK_SECRET,
  )
    .update(raw)
    .digest('hex')}`;
  return { body, raw, signature };
}

const storedContract = {
  id: contractId,
  contractNumber: 'EC-2026-CONTRACT',
  provider: ElectronicContractProvider.MODOOSIGN,
  providerContractId: 'provider-contract-1',
  memberUserId: '019c75df-0255-7000-8000-000000000722',
  registrantUserId: '019c75df-0255-7000-8000-000000000723',
  status: ElectronicContractStatus.PARTIALLY_SIGNED,
  parties: [],
};

describe('ContractWebhookService', () => {
  it('stores only encrypted document references on signed events', async () => {
    const webhook = signedWebhook();
    const tx = {
      electronicContract: { update: vi.fn(async () => ({})) },
      electronicContractParty: { updateMany: vi.fn(async () => ({ count: 1 })) },
      electronicContractHistory: { create: vi.fn(async () => ({})) },
      contractWebhookEvent: { update: vi.fn(async () => ({})) },
      notificationOutbox: { createMany: vi.fn(async () => ({ count: 2 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      contractWebhookEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      electronicContract: {
        findUnique: vi.fn(async () => storedContract),
      },
      $transaction: vi.fn(
        async (callback: (transaction: typeof tx) => unknown) =>
          callback(tx),
      ),
    } as unknown as PrismaService;
    const sensitiveData = {
      encrypt: vi.fn(() => 'encrypted-reference'),
      hash: vi.fn(() => 'reference-hash'),
    } as unknown as SensitiveDataService;

    const result = await new ContractWebhookService(
      prisma,
      new ContractProviderService(),
      sensitiveData,
    ).handle(
      ElectronicContractProvider.MODOOSIGN,
      eventId,
      webhook.signature,
      webhook.raw,
      webhook.body,
    );

    expect(result.contractStatus).toBe(ElectronicContractStatus.SIGNED);
    const update = tx.electronicContract.update.mock.calls[0]?.[0];
    expect(update?.data.signedDocumentReferenceEncrypted).toBe(
      'encrypted-reference',
    );
    expect(JSON.stringify(update)).not.toContain(
      webhook.body.documentReference,
    );
    expect(tx.electronicContractParty.updateMany).toHaveBeenCalledTimes(2);
    expect(
      tx.electronicContractParty.updateMany.mock.calls[0]?.[0].where.role,
    ).toBe(ElectronicContractPartyRole.MEMBER);
    expect(JSON.stringify(tx.auditLog.create.mock.calls[0]?.[0])).not.toContain(
      webhook.body.documentReference,
    );
  });

  it('fails a signed event that has no document reference or hash', async () => {
    process.env.CONTRACT_WEBHOOK_SECRET = 'contract-webhook-test-secret';
    const body = {
      providerContractId: 'provider-contract-1',
      eventType: 'contract.signed',
      status: 'SIGNED',
    };
    const raw = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac(
      'sha256',
      process.env.CONTRACT_WEBHOOK_SECRET,
    )
      .update(raw)
      .digest('hex')}`;
    const update = vi.fn(async () => ({}));
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const prisma = {
      contractWebhookEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        update,
        updateMany,
      },
      electronicContract: {
        findUnique: vi.fn(async () => storedContract),
      },
    } as unknown as PrismaService;

    await expect(
      new ContractWebhookService(
        prisma,
        new ContractProviderService(),
        {} as SensitiveDataService,
      ).handle(
        ElectronicContractProvider.MODOOSIGN,
        eventId,
        signature,
        raw,
        body,
      ),
    ).rejects.toThrow(ConflictException);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ContractWebhookEventStatus.FAILED,
        }),
      }),
    );
  });

  it('rejects a changed body for an already used event id', async () => {
    const webhook = signedWebhook();
    const prisma = {
      contractWebhookEvent: {
        findUnique: vi.fn(async () => ({
          payloadHash: 'not-the-same-hash',
          status: ContractWebhookEventStatus.PROCESSED,
        })),
      },
    } as unknown as PrismaService;

    await expect(
      new ContractWebhookService(
        prisma,
        new ContractProviderService(),
        {} as SensitiveDataService,
      ).handle(
        ElectronicContractProvider.MODOOSIGN,
        eventId,
        webhook.signature,
        webhook.raw,
        webhook.body,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('ignores attempts to move a signed contract backwards', async () => {
    process.env.CONTRACT_WEBHOOK_SECRET = 'contract-webhook-test-secret';
    const body = {
      providerContractId: 'provider-contract-1',
      eventType: 'contract.viewed',
      status: 'PARTIALLY_SIGNED',
    };
    const raw = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac(
      'sha256',
      process.env.CONTRACT_WEBHOOK_SECRET,
    )
      .update(raw)
      .digest('hex')}`;
    const update = vi.fn(async () => ({}));
    const prisma = {
      contractWebhookEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        update,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      electronicContract: {
        findUnique: vi.fn(async () => ({
          ...storedContract,
          status: ElectronicContractStatus.SIGNED,
        })),
      },
    } as unknown as PrismaService;

    const result = await new ContractWebhookService(
      prisma,
      new ContractProviderService(),
      {} as SensitiveDataService,
    ).handle(
      ElectronicContractProvider.MODOOSIGN,
      eventId,
      signature,
      raw,
      body,
    );

    expect(result.status).toBe(ContractWebhookEventStatus.IGNORED);
    expect(update).toHaveBeenCalledOnce();
  });
});
