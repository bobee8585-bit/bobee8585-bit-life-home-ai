import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  ElectronicContractPartyRole,
  ElectronicContractStatus,
  Prisma,
  VisitReservationStatus,
} from '../generated/prisma/client';
import type { CreateElectronicContractDto } from './dto/create-electronic-contract.dto';
import type { ListElectronicContractsDto } from './dto/list-electronic-contracts.dto';
import { ContractProviderService } from './contract-provider.service';
import { ContractSafetyRecheckService } from './contract-safety-recheck.service';

const contractInclude = {
  property: {
    select: {
      id: true,
      listingNumber: true,
      title: true,
      listingType: true,
      transactionType: true,
      city: true,
    },
  },
  reservation: {
    select: {
      id: true,
      reservationNumber: true,
      status: true,
    },
  },
  parties: {
    orderBy: { role: 'asc' as const },
    include: {
      user: {
        select: {
          memberNumber: true,
          profile: { select: { displayName: true } },
        },
      },
    },
  },
  safetyRechecks: {
    orderBy: { attempt: 'desc' as const },
    take: 1,
  },
} as const;

type ContractViewInput = Prisma.ElectronicContractGetPayload<{
  include: typeof contractInclude;
}>;

@Injectable()
export class ElectronicContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ContractProviderService,
    private readonly safetyRechecks: ContractSafetyRecheckService,
  ) {}

  async create(
    userId: string,
    reservationId: string,
    dto: CreateElectronicContractDto,
  ) {
    if (
      !dto.consent.personalDataProvision ||
      !dto.consent.electronicSignature ||
      !dto.consent.providerTerms
    ) {
      throw new ForbiddenException(
        '전자계약 생성에는 필수 동의가 모두 필요합니다.',
      );
    }
    const reservation = await this.prisma.visitReservation.findFirst({
      where: {
        id: reservationId,
        status: {
          in: [
            VisitReservationStatus.CONFIRMED,
            VisitReservationStatus.COMPLETED,
          ],
        },
        OR: [{ requesterId: userId }, { brokerUserId: userId }],
      },
      include: {
        property: {
          select: {
            id: true,
            listingNumber: true,
            title: true,
          },
        },
        requester: {
          select: { id: true, phoneVerifiedAt: true },
        },
        broker: {
          select: { id: true, phoneVerifiedAt: true },
        },
      },
    });
    if (!reservation) {
      throw new NotFoundException(
        '전자계약을 만들 수 있는 확정 방문 예약을 찾을 수 없습니다.',
      );
    }
    if (
      !reservation.requester.phoneVerifiedAt ||
      !reservation.broker.phoneVerifiedAt
    ) {
      throw new ForbiddenException(
        '계약 당사자 모두 휴대폰 본인인증을 완료해야 합니다.',
      );
    }
    const existing = await this.prisma.electronicContract.findUnique({
      where: { reservationId },
      include: contractInclude,
    });
    if (existing) {
      return {
        contract: this.view(existing, userId),
        signingUrl: null,
        alreadyExists: true,
      };
    }

    const id = createId();
    const now = new Date();
    const retainedUntil = new Date(now);
    retainedUntil.setUTCFullYear(retainedUntil.getUTCFullYear() + 10);
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.electronicContract.create({
          data: {
            id,
            contractNumber: this.contractNumber(id, now),
            reservationId: reservation.id,
            propertyId: reservation.property.id,
            memberUserId: reservation.requester.id,
            registrantUserId: reservation.broker.id,
            createdByUserId: userId,
            provider: dto.provider,
            termsVersion: dto.termsVersion,
            termsSnapshot: {
              termsVersion: dto.termsVersion,
              consent: {
                personalDataProvision:
                  dto.consent.personalDataProvision,
                electronicSignature: dto.consent.electronicSignature,
                providerTerms: dto.consent.providerTerms,
              },
              reservationNumber: reservation.reservationNumber,
              capturedAt: now.toISOString(),
            },
            retainedUntil,
            parties: {
              create: [
                {
                  id: createId(),
                  userId: reservation.requester.id,
                  role: ElectronicContractPartyRole.MEMBER,
                },
                {
                  id: createId(),
                  userId: reservation.broker.id,
                  role: ElectronicContractPartyRole.REGISTRANT,
                },
              ],
            },
            histories: {
              create: {
                id: createId(),
                previousStatus: null,
                nextStatus: ElectronicContractStatus.DRAFT,
                source: 'PLATFORM',
                eventType: 'CONTRACT_CREATED',
                actorUserId: userId,
              },
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: userId,
            action: 'ELECTRONIC_CONTRACT.CREATE',
            targetType: 'ElectronicContract',
            targetId: id,
            afterData: {
              reservationId,
              propertyId: reservation.property.id,
              provider: dto.provider,
              termsVersion: dto.termsVersion,
            },
          },
        });
      });
    } catch (error: unknown) {
      if (this.prismaCode(error) !== 'P2002') {
        throw error;
      }
      const concurrent = await this.prisma.electronicContract.findUnique({
        where: { reservationId },
        include: contractInclude,
      });
      if (!concurrent) {
        throw error;
      }
      return {
        contract: this.view(concurrent, userId),
        signingUrl: null,
        alreadyExists: true,
      };
    }
    return this.startSigning(userId, id);
  }

  async startSigning(userId: string, contractId: string) {
    const contract = await this.contractForParticipant(contractId, userId);
    if (
      contract.status !== ElectronicContractStatus.DRAFT &&
      contract.status !== ElectronicContractStatus.FAILED
    ) {
      throw new ConflictException(
        '현재 상태에서는 전자서명 세션을 다시 시작할 수 없습니다.',
      );
    }
    await this.safetyRechecks.ensurePassedForSigning(userId, contract.id);

    const claimed = await this.prisma.$transaction(
      async (transaction) => {
        const result = await transaction.electronicContract.updateMany({
          where: {
            id: contract.id,
            status: contract.status,
          },
          data: {
            status: ElectronicContractStatus.SIGNING_PENDING,
            failureCode: null,
          },
        });
        if (result.count === 0) {
          return false;
        }
        await transaction.electronicContractHistory.create({
          data: {
            id: createId(),
            contractId: contract.id,
            previousStatus: contract.status,
            nextStatus: ElectronicContractStatus.SIGNING_PENDING,
            source: 'PLATFORM',
            eventType: 'SIGNING_SESSION_REQUESTED',
            actorUserId: userId,
          },
        });
        return true;
      },
    );
    if (!claimed) {
      throw new ConflictException(
        '다른 요청이 전자서명 세션을 시작하고 있습니다.',
      );
    }

    try {
      const session = await this.provider.createSigningSession({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        provider: contract.provider,
        requestedByRole:
          contract.memberUserId === userId ? 'MEMBER' : 'REGISTRANT',
        property: contract.property,
        parties: contract.parties.map((party) => ({
          role: party.role,
          userReference: party.userId,
        })),
      });
      const updated = await this.prisma.$transaction(async (transaction) => {
        const result = await transaction.electronicContract.update({
          where: { id: contract.id },
          data: {
            providerContractId: session.providerContractId,
            signingExpiresAt: session.expiresAt,
            failureCode: null,
          },
          include: contractInclude,
        });
        await transaction.notificationOutbox.createMany({
          data: [contract.memberUserId, contract.registrantUserId].map(
            (recipientUserId) => ({
              id: createId(),
              recipientUserId,
              type: 'CONTRACT_SIGNING_READY',
              aggregateType: 'ElectronicContract',
              aggregateId: contract.id,
              payload: {
                contractId: contract.id,
                contractNumber: contract.contractNumber,
                listingNumber: contract.property.listingNumber,
              },
            }),
          ),
        });
        return result;
      });
      return {
        contract: this.view(updated, userId),
        signingUrl: session.signingUrl,
        alreadyExists: false,
      };
    } catch (error: unknown) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.electronicContract.update({
          where: { id: contract.id },
          data: {
            status: ElectronicContractStatus.FAILED,
            failureCode: 'PROVIDER_SESSION_CREATE_FAILED',
          },
        });
        await transaction.electronicContractHistory.create({
          data: {
            id: createId(),
            contractId: contract.id,
            previousStatus: ElectronicContractStatus.SIGNING_PENDING,
            nextStatus: ElectronicContractStatus.FAILED,
            source: 'PLATFORM',
            eventType: 'SIGNING_SESSION_FAILED',
            actorUserId: userId,
          },
        });
      });
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        '전자계약 서명 세션을 만들지 못했습니다. 다시 시도해 주세요.',
      );
    }
  }

  async list(userId: string, query: ListElectronicContractsDto) {
    const where = {
      OR: [{ memberUserId: userId }, { registrantUserId: userId }],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.electronicContract.findMany({
        where,
        include: contractInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.electronicContract.count({ where }),
    ]);
    return {
      items: items.map((contract) => this.view(contract, userId)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async get(userId: string, contractId: string) {
    return this.view(
      await this.contractForParticipant(contractId, userId),
      userId,
    );
  }

  private async contractForParticipant(contractId: string, userId: string) {
    const contract = await this.prisma.electronicContract.findFirst({
      where: {
        id: contractId,
        OR: [{ memberUserId: userId }, { registrantUserId: userId }],
      },
      include: contractInclude,
    });
    if (!contract) {
      throw new NotFoundException('전자계약을 찾을 수 없습니다.');
    }
    return contract;
  }

  private view(contract: ContractViewInput, userId: string) {
    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      provider: contract.provider,
      status: contract.status,
      reservation: contract.reservation,
      property: contract.property,
      myRole:
        contract.memberUserId === userId
          ? ElectronicContractPartyRole.MEMBER
          : ElectronicContractPartyRole.REGISTRANT,
      parties: contract.parties.map((party) => ({
        role: party.role,
        status: party.status,
        memberNumber: party.user.memberNumber,
        displayName: party.user.profile?.displayName ?? '',
        viewedAt: party.viewedAt?.toISOString() ?? null,
        signedAt: party.signedAt?.toISOString() ?? null,
        declinedAt: party.declinedAt?.toISOString() ?? null,
      })),
      termsVersion: contract.termsVersion,
      signingExpiresAt: contract.signingExpiresAt?.toISOString() ?? null,
      signedAt: contract.signedAt?.toISOString() ?? null,
      signedDocumentAvailable:
        Boolean(contract.signedDocumentReferenceEncrypted) &&
        contract.status === ElectronicContractStatus.SIGNED,
      signedDocumentHash: contract.signedDocumentHash,
      retainedUntil: contract.retainedUntil.toISOString(),
      safetyRecheck: contract.safetyRechecks[0]
        ? {
            id: contract.safetyRechecks[0].id,
            attempt: contract.safetyRechecks[0].attempt,
            status: contract.safetyRechecks[0].status,
            failureCode: contract.safetyRechecks[0].failureCode,
            expiresAt:
              contract.safetyRechecks[0].expiresAt?.toISOString() ?? null,
          }
        : null,
      createdAt: contract.createdAt.toISOString(),
      updatedAt: contract.updatedAt.toISOString(),
    };
  }

  private contractNumber(id: string, now: Date): string {
    return `EC-${now.getUTCFullYear()}-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
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
