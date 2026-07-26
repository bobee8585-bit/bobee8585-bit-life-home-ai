import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  ContractWebhookEventStatus,
  ElectronicContractPartyRole,
  ElectronicContractPartyStatus,
  ElectronicContractProvider,
  ElectronicContractStatus,
  Prisma,
} from '../generated/prisma/client';
import {
  ContractProviderService,
  type ContractWebhookPayload,
} from './contract-provider.service';

@Injectable()
export class ContractWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerService: ContractProviderService,
    private readonly sensitiveData: SensitiveDataService,
  ) {}

  async handle(
    provider: ElectronicContractProvider,
    transmissionId: string | undefined,
    signature: string | undefined,
    rawBody: Buffer | undefined,
    body: unknown,
  ) {
    if (!transmissionId?.trim()) {
      throw new NotFoundException('전자계약 웹훅 전송 ID가 없습니다.');
    }
    const verified = this.providerService.verifyWebhook(
      rawBody,
      signature,
      body,
    );
    const payloadHash = createHash('sha256').update(rawBody!).digest('hex');
    const previous = await this.prisma.contractWebhookEvent.findUnique({
      where: {
        provider_transmissionId: {
          provider,
          transmissionId: transmissionId.trim(),
        },
      },
    });
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new ConflictException(
          '동일한 전자계약 웹훅 ID의 본문이 변경되었습니다.',
        );
      }
      if (
        previous.status === ContractWebhookEventStatus.PROCESSED ||
        previous.status === ContractWebhookEventStatus.IGNORED
      ) {
        return {
          accepted: true,
          duplicate: true,
          status: previous.status,
        };
      }
      if (previous.status === ContractWebhookEventStatus.RECEIVED) {
        throw new ConflictException(
          '동일한 전자계약 웹훅을 처리 중입니다.',
        );
      }
      await this.prisma.contractWebhookEvent.update({
        where: { id: previous.id },
        data: {
          status: ContractWebhookEventStatus.RECEIVED,
          failureCode: null,
          processedAt: null,
        },
      });
      return this.processSafely(previous.id, provider, verified);
    }

    const eventId = createId();
    try {
      await this.prisma.contractWebhookEvent.create({
        data: {
          id: eventId,
          provider,
          transmissionId: transmissionId.trim(),
          eventType: verified.eventType,
          providerContractId: verified.providerContractId,
          payloadHash,
        },
      });
    } catch (error: unknown) {
      if (this.prismaCode(error) === 'P2002') {
        throw new ConflictException(
          '동일한 전자계약 웹훅을 처리 중입니다.',
        );
      }
      throw error;
    }
    return this.processSafely(eventId, provider, verified);
  }

  private async processSafely(
    eventId: string,
    provider: ElectronicContractProvider,
    payload: ContractWebhookPayload,
  ) {
    try {
      return await this.process(eventId, provider, payload);
    } catch (error: unknown) {
      await this.prisma.contractWebhookEvent.updateMany({
        where: {
          id: eventId,
          status: ContractWebhookEventStatus.RECEIVED,
        },
        data: {
          status: ContractWebhookEventStatus.FAILED,
          failureCode: this.errorCode(error),
          processedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async process(
    eventId: string,
    provider: ElectronicContractProvider,
    payload: ContractWebhookPayload,
  ) {
    const contract = await this.prisma.electronicContract.findUnique({
      where: { providerContractId: payload.providerContractId },
      include: { parties: true },
    });
    if (!contract || contract.provider !== provider) {
      await this.prisma.contractWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: ContractWebhookEventStatus.IGNORED,
          processedAt: new Date(),
        },
      });
      return {
        accepted: true,
        duplicate: false,
        status: ContractWebhookEventStatus.IGNORED,
      };
    }

    const nextStatus = ElectronicContractStatus[payload.status];
    if (!this.canTransition(contract.status, nextStatus)) {
      await this.prisma.contractWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: ContractWebhookEventStatus.IGNORED,
          contractId: contract.id,
          processedAt: new Date(),
        },
      });
      return {
        accepted: true,
        duplicate: false,
        status: ContractWebhookEventStatus.IGNORED,
        contractId: contract.id,
      };
    }

    if (
      nextStatus === ElectronicContractStatus.SIGNED &&
      (!payload.documentReference ||
        !payload.documentHash?.match(/^[a-fA-F0-9]{64}$/))
    ) {
      await this.failEvent(eventId, contract.id, 'SIGNED_DOCUMENT_MISSING');
      throw new ConflictException(
        '서명 완료 웹훅에 계약 문서 참조값과 SHA-256 해시가 필요합니다.',
      );
    }
    const occurredAt = this.date(payload.occurredAt);
    const retainedUntil = new Date(occurredAt);
    retainedUntil.setUTCFullYear(retainedUntil.getUTCFullYear() + 10);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.electronicContract.update({
        where: { id: contract.id },
        data: {
          status: nextStatus,
          failureCode:
            nextStatus === ElectronicContractStatus.FAILED
              ? 'PROVIDER_REPORTED_FAILURE'
              : null,
          signedAt:
            nextStatus === ElectronicContractStatus.SIGNED
              ? occurredAt
              : undefined,
          retainedUntil:
            nextStatus === ElectronicContractStatus.SIGNED
              ? retainedUntil
              : undefined,
          signedDocumentReferenceEncrypted: payload.documentReference
            ? this.sensitiveData.encrypt(payload.documentReference)
            : undefined,
          signedDocumentReferenceHash: payload.documentReference
            ? this.sensitiveData.hash(payload.documentReference)
            : undefined,
          signedDocumentHash: payload.documentHash?.toLowerCase(),
        },
      });
      await this.updateParties(transaction, contract.id, payload, occurredAt);
      await transaction.electronicContractHistory.create({
        data: {
          id: createId(),
          contractId: contract.id,
          previousStatus: contract.status,
          nextStatus,
          source: 'PROVIDER_WEBHOOK',
          eventType: payload.eventType,
        },
      });
      await transaction.contractWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: ContractWebhookEventStatus.PROCESSED,
          contractId: contract.id,
          processedAt: new Date(),
        },
      });
      await transaction.notificationOutbox.createMany({
        data: [contract.memberUserId, contract.registrantUserId].map(
          (recipientUserId) => ({
            id: createId(),
            recipientUserId,
            type: 'CONTRACT_STATUS_CHANGED',
            aggregateType: 'ElectronicContract',
            aggregateId: contract.id,
            payload: {
              contractId: contract.id,
              contractNumber: contract.contractNumber,
              status: nextStatus,
            },
          }),
        ),
      });
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: null,
          action: 'ELECTRONIC_CONTRACT.STATUS_SYNC',
          targetType: 'ElectronicContract',
          targetId: contract.id,
          beforeData: { status: contract.status },
          afterData: {
            status: nextStatus,
            eventType: payload.eventType,
            signedDocumentHash: payload.documentHash?.toLowerCase(),
          },
        },
      });
    });
    return {
      accepted: true,
      duplicate: false,
      status: ContractWebhookEventStatus.PROCESSED,
      contractId: contract.id,
      contractStatus: nextStatus,
    };
  }

  private async updateParties(
    transaction: Prisma.TransactionClient,
    contractId: string,
    payload: ContractWebhookPayload,
    occurredAt: Date,
  ) {
    const parties =
      payload.parties ??
      (payload.status === 'SIGNED'
        ? [
            { role: 'MEMBER' as const, status: 'SIGNED' as const },
            { role: 'REGISTRANT' as const, status: 'SIGNED' as const },
          ]
        : []);
    for (const party of parties) {
      if (party.status === 'PENDING') {
        continue;
      }
      const date = this.date(party.occurredAt) ?? occurredAt;
      await transaction.electronicContractParty.updateMany({
        where: {
          contractId,
          role: ElectronicContractPartyRole[party.role],
          status:
            party.status === 'VIEWED'
              ? ElectronicContractPartyStatus.PENDING
              : {
                  in: [
                    ElectronicContractPartyStatus.PENDING,
                    ElectronicContractPartyStatus.VIEWED,
                  ],
                },
        },
        data: {
          status: ElectronicContractPartyStatus[party.status],
          viewedAt:
            party.status === 'VIEWED' ? date : undefined,
          signedAt:
            party.status === 'SIGNED' ? date : undefined,
          declinedAt:
            party.status === 'DECLINED' ? date : undefined,
        },
      });
    }
  }

  private canTransition(
    current: ElectronicContractStatus,
    next: ElectronicContractStatus,
  ): boolean {
    if (current === next) {
      return false;
    }
    const terminal = new Set<ElectronicContractStatus>([
      ElectronicContractStatus.SIGNED,
      ElectronicContractStatus.DECLINED,
      ElectronicContractStatus.CANCELLED,
      ElectronicContractStatus.EXPIRED,
    ]);
    if (terminal.has(current)) {
      return false;
    }
    if (next === ElectronicContractStatus.SIGNING_PENDING) {
      return (
        current === ElectronicContractStatus.DRAFT ||
        current === ElectronicContractStatus.FAILED
      );
    }
    return current !== ElectronicContractStatus.DRAFT;
  }

  private async failEvent(
    eventId: string,
    contractId: string,
    failureCode: string,
  ) {
    await this.prisma.contractWebhookEvent.update({
      where: { id: eventId },
      data: {
        status: ContractWebhookEventStatus.FAILED,
        contractId,
        failureCode,
        processedAt: new Date(),
      },
    });
  }

  private date(value: string | undefined): Date {
    if (!value) {
      return new Date();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private prismaCode(error: unknown): string | undefined {
    return typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
      ? error.code
      : undefined;
  }

  private errorCode(error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      typeof error.name === 'string'
    ) {
      return error.name.slice(0, 80);
    }
    return 'CONTRACT_WEBHOOK_FAILED';
  }
}
