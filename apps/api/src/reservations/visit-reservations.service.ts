import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  Prisma,
  OwnershipVerificationStatus,
  PropertyListingType,
  PropertyStatus,
  ReservationRefundReason,
  VisitReservationAction,
  VisitReservationStatus,
} from '../generated/prisma/client';
import { ReservationDepositService } from '../payments/reservation-deposit.service';
import type { CreateVisitReservationDto } from './dto/create-visit-reservation.dto';
import type { ListVisitReservationsDto } from './dto/list-visit-reservations.dto';
import type { ProposeAlternativeDto } from './dto/propose-alternative.dto';

const reservationInclude = {
  property: {
    select: {
      id: true,
      listingNumber: true,
      title: true,
      status: true,
      city: true,
      addressLine1: true,
      brokerageOffice: { select: { id: true, name: true } },
    },
  },
  requester: {
    select: {
      memberNumber: true,
      profile: { select: { displayName: true } },
    },
  },
  broker: {
    select: {
      memberNumber: true,
      profile: { select: { displayName: true } },
    },
  },
  histories: {
    include: { actor: { select: { memberNumber: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  deposit: {
    include: {
      transactions: { orderBy: { createdAt: 'asc' as const } },
    },
  },
} as const;

type ReservationViewInput = Prisma.VisitReservationGetPayload<{
  include: typeof reservationInclude;
}>;

@Injectable()
export class VisitReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deposits: ReservationDepositService,
  ) {}

  async create(
    requesterId: string,
    propertyId: string,
    dto: CreateVisitReservationDto,
  ) {
    const { startAt, endAt } = this.visitWindow(dto.startAt, dto.endAt);
    const [user, property] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { phoneVerifiedAt: true },
      }),
      this.prisma.property.findFirst({
        where: {
          id: propertyId,
          status: PropertyStatus.ACTIVE,
          OR: [
            { listingType: PropertyListingType.BROKERAGE },
            {
              listingType: PropertyListingType.OWNER_DIRECT,
              ownershipVerification: {
                status: OwnershipVerificationStatus.VERIFIED,
              },
            },
          ],
        },
        select: {
          id: true,
          brokerUserId: true,
          listingNumber: true,
          title: true,
        },
      }),
    ]);
    if (!user?.phoneVerifiedAt) {
      throw new ForbiddenException(
        '방문 예약 전 휴대폰 본인인증이 필요합니다.',
      );
    }
    if (!property) {
      throw new NotFoundException('공개 중인 매물을 찾을 수 없습니다.');
    }
    if (property.brokerUserId === requesterId) {
      throw new ForbiddenException('본인 매물에는 방문 예약을 할 수 없습니다.');
    }
    const [duplicate, requesterConflict] = await Promise.all([
      this.prisma.visitReservation.findFirst({
        where: {
          propertyId,
          requesterId,
          status: {
            in: [
              VisitReservationStatus.REQUESTED,
              VisitReservationStatus.ALTERNATIVE_PROPOSED,
              VisitReservationStatus.CONFIRMED,
            ],
          },
        },
        select: { id: true },
      }),
      this.findRequesterConflict(requesterId, startAt, endAt),
    ]);
    if (duplicate) {
      throw new ConflictException(
        '이 매물에 처리 중이거나 확정된 방문 예약이 있습니다.',
      );
    }
    if (requesterConflict) {
      throw new ConflictException('같은 시간대의 다른 방문 예약이 있습니다.');
    }

    const id = createId();
    const reservationNumber = this.reservationNumber(id);
    try {
      const reservation = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.visitReservation.create({
            data: {
              id,
              reservationNumber,
              propertyId,
              requesterId,
              brokerUserId: property.brokerUserId,
              requestedStartAt: startAt,
              requestedEndAt: endAt,
              requestMessage: this.optionalText(dto.message),
            },
          });
          await transaction.visitReservationHistory.create({
            data: {
              id: createId(),
              reservationId: id,
              actorId: requesterId,
              action: VisitReservationAction.REQUESTED,
              previousStatus: null,
              nextStatus: VisitReservationStatus.REQUESTED,
              note: this.optionalText(dto.message),
              startAt,
              endAt,
            },
          });
          await this.enqueue(
            transaction,
            property.brokerUserId,
            'VISIT_RESERVATION_REQUESTED',
            id,
            {
              reservationNumber,
              listingNumber: property.listingNumber,
              title: property.title,
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString(),
            },
          );
          await transaction.auditLog.create({
            data: {
              id: createId(),
              actorId: requesterId,
              action: 'VISIT_RESERVATION.REQUEST',
              targetType: 'VisitReservation',
              targetId: id,
              afterData: {
                propertyId,
                status: VisitReservationStatus.REQUESTED,
                startAt: startAt.toISOString(),
                endAt: endAt.toISOString(),
                autoConfirmed: false,
              },
            },
          });
          return transaction.visitReservation.findUniqueOrThrow({
            where: { id },
            include: reservationInclude,
          });
        },
      );
      return this.view(reservation);
    } catch (error: unknown) {
      if (this.prismaCode(error) === 'P2002') {
        throw new ConflictException(
          '이 매물에 처리 중이거나 확정된 방문 예약이 있습니다.',
        );
      }
      throw error;
    }
  }

  async mine(requesterId: string, query: ListVisitReservationsDto) {
    return this.list({ requesterId }, query);
  }

  async brokerList(brokerUserId: string, query: ListVisitReservationsDto) {
    return this.list({ brokerUserId }, query);
  }

  async approve(
    brokerUserId: string,
    reservationId: string,
    message?: string,
  ) {
    const reservation = await this.forBroker(reservationId, brokerUserId);
    if (reservation.status !== VisitReservationStatus.REQUESTED) {
      throw new ConflictException('예약 요청 상태에서만 승인할 수 있습니다.');
    }
    if (reservation.requestedStartAt <= new Date()) {
      throw new ConflictException('이미 시작 시간이 지난 예약입니다.');
    }
    await this.assertBrokerAvailability(
      brokerUserId,
      reservation.requestedStartAt,
      reservation.requestedEndAt,
      reservationId,
    );
    return this.brokerTransition({
      reservation,
      actorId: brokerUserId,
      nextStatus: VisitReservationStatus.CONFIRMED,
      action: VisitReservationAction.APPROVED,
      notificationType: 'VISIT_RESERVATION_APPROVED',
      note: this.optionalText(message),
      update: {
        confirmedStartAt: reservation.requestedStartAt,
        confirmedEndAt: reservation.requestedEndAt,
        responseMessage: this.optionalText(message),
        respondedAt: new Date(),
      },
      startAt: reservation.requestedStartAt,
      endAt: reservation.requestedEndAt,
    });
  }

  async reject(
    brokerUserId: string,
    reservationId: string,
    reason: string,
  ) {
    const reservation = await this.forBroker(reservationId, brokerUserId);
    if (reservation.status !== VisitReservationStatus.REQUESTED) {
      throw new ConflictException('예약 요청 상태에서만 거절할 수 있습니다.');
    }
    return this.brokerTransition({
      reservation,
      actorId: brokerUserId,
      nextStatus: VisitReservationStatus.REJECTED,
      action: VisitReservationAction.REJECTED,
      notificationType: 'VISIT_RESERVATION_REJECTED',
      note: reason.trim(),
      update: {
        responseMessage: reason.trim(),
        respondedAt: new Date(),
      },
      startAt: reservation.requestedStartAt,
      endAt: reservation.requestedEndAt,
    });
  }

  async proposeAlternative(
    brokerUserId: string,
    reservationId: string,
    dto: ProposeAlternativeDto,
  ) {
    const reservation = await this.forBroker(reservationId, brokerUserId);
    if (reservation.status !== VisitReservationStatus.REQUESTED) {
      throw new ConflictException(
        '예약 요청 상태에서만 대안 시간을 제안할 수 있습니다.',
      );
    }
    const { startAt, endAt } = this.visitWindow(dto.startAt, dto.endAt);
    await this.assertBrokerAvailability(
      brokerUserId,
      startAt,
      endAt,
      reservationId,
    );
    const now = new Date();
    const alternativeExpiresAt = new Date(
      Math.min(
        now.getTime() + 24 * 60 * 60 * 1_000,
        startAt.getTime() - 60 * 60 * 1_000,
      ),
    );
    return this.brokerTransition({
      reservation,
      actorId: brokerUserId,
      nextStatus: VisitReservationStatus.ALTERNATIVE_PROPOSED,
      action: VisitReservationAction.ALTERNATIVE_PROPOSED,
      notificationType: 'VISIT_RESERVATION_ALTERNATIVE_PROPOSED',
      note: this.optionalText(dto.message),
      update: {
        alternativeStartAt: startAt,
        alternativeEndAt: endAt,
        alternativeExpiresAt,
        responseMessage: this.optionalText(dto.message),
        respondedAt: now,
      },
      startAt,
      endAt,
      notificationExtra: {
        alternativeExpiresAt: alternativeExpiresAt.toISOString(),
      },
    });
  }

  async acceptAlternative(requesterId: string, reservationId: string) {
    const reservation = await this.forRequester(reservationId, requesterId);
    const now = new Date();
    if (
      reservation.status !== VisitReservationStatus.ALTERNATIVE_PROPOSED ||
      !reservation.alternativeStartAt ||
      !reservation.alternativeEndAt ||
      !reservation.alternativeExpiresAt
    ) {
      throw new ConflictException('수락할 수 있는 대안 시간이 없습니다.');
    }
    if (
      reservation.alternativeExpiresAt <= now ||
      reservation.alternativeStartAt <= now
    ) {
      throw new ConflictException('대안 시간 응답 기한이 지났습니다.');
    }
    await this.assertBrokerAvailability(
      reservation.brokerUserId,
      reservation.alternativeStartAt,
      reservation.alternativeEndAt,
      reservationId,
    );
    const requesterConflict = await this.findRequesterConflict(
      requesterId,
      reservation.alternativeStartAt,
      reservation.alternativeEndAt,
      reservationId,
    );
    if (requesterConflict) {
      throw new ConflictException('같은 시간대의 다른 방문 예약이 있습니다.');
    }
    return this.requesterTransition({
      reservation,
      actorId: requesterId,
      expectedStatus: VisitReservationStatus.ALTERNATIVE_PROPOSED,
      nextStatus: VisitReservationStatus.CONFIRMED,
      action: VisitReservationAction.ALTERNATIVE_ACCEPTED,
      notificationType: 'VISIT_RESERVATION_ALTERNATIVE_ACCEPTED',
      note: '대안 시간을 수락했습니다.',
      update: {
        confirmedStartAt: reservation.alternativeStartAt,
        confirmedEndAt: reservation.alternativeEndAt,
        respondedAt: now,
      },
      startAt: reservation.alternativeStartAt,
      endAt: reservation.alternativeEndAt,
      requireUnexpiredAlternative: true,
    });
  }

  async declineAlternative(
    requesterId: string,
    reservationId: string,
    reason: string,
  ) {
    const reservation = await this.forRequester(reservationId, requesterId);
    if (reservation.status !== VisitReservationStatus.ALTERNATIVE_PROPOSED) {
      throw new ConflictException('거절할 수 있는 대안 시간이 없습니다.');
    }
    return this.requesterTransition({
      reservation,
      actorId: requesterId,
      expectedStatus: VisitReservationStatus.ALTERNATIVE_PROPOSED,
      nextStatus: VisitReservationStatus.ALTERNATIVE_DECLINED,
      action: VisitReservationAction.ALTERNATIVE_DECLINED,
      notificationType: 'VISIT_RESERVATION_ALTERNATIVE_DECLINED',
      note: reason.trim(),
      update: { cancellationReason: reason.trim(), cancelledAt: new Date() },
      startAt: reservation.alternativeStartAt,
      endAt: reservation.alternativeEndAt,
    });
  }

  async cancel(
    requesterId: string,
    reservationId: string,
    reason: string,
  ) {
    const reservation = await this.forRequester(reservationId, requesterId);
    const cancellable: VisitReservationStatus[] = [
      VisitReservationStatus.REQUESTED,
      VisitReservationStatus.ALTERNATIVE_PROPOSED,
      VisitReservationStatus.CONFIRMED,
    ];
    if (!cancellable.includes(reservation.status)) {
      throw new ConflictException('현재 상태에서는 예약을 취소할 수 없습니다.');
    }
    if (
      reservation.status === VisitReservationStatus.CONFIRMED &&
      reservation.confirmedStartAt &&
      reservation.confirmedStartAt <= new Date()
    ) {
      throw new ConflictException('이미 시작된 방문 예약은 취소할 수 없습니다.');
    }
    return this.requesterTransition({
      reservation,
      actorId: requesterId,
      expectedStatus: reservation.status,
      nextStatus: VisitReservationStatus.CANCELLED,
      action: VisitReservationAction.CANCELLED,
      notificationType: 'VISIT_RESERVATION_CANCELLED',
      note: reason.trim(),
      update: { cancellationReason: reason.trim(), cancelledAt: new Date() },
      startAt:
        reservation.confirmedStartAt ??
        reservation.alternativeStartAt ??
        reservation.requestedStartAt,
      endAt:
        reservation.confirmedEndAt ??
        reservation.alternativeEndAt ??
        reservation.requestedEndAt,
      refundReason: ReservationRefundReason.USER_CANCELLATION,
    });
  }

  private async list(
    owner: { requesterId?: string; brokerUserId?: string },
    query: ListVisitReservationsDto,
  ) {
    const where = {
      ...owner,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.visitReservation.findMany({
        where,
        include: reservationInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.visitReservation.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.view(row)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  private async brokerTransition(input: {
    reservation: ReservationViewInput;
    actorId: string;
    nextStatus: VisitReservationStatus;
    action: VisitReservationAction;
    notificationType: string;
    note: string | null;
    update: Prisma.VisitReservationUpdateManyMutationInput;
    startAt: Date | null;
    endAt: Date | null;
    notificationExtra?: Record<string, string>;
  }) {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.visitReservation.updateMany({
        where: {
          id: input.reservation.id,
          brokerUserId: input.actorId,
          status: input.reservation.status,
        },
        data: { ...input.update, status: input.nextStatus },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          '예약 상태가 변경되어 다시 확인해야 합니다.',
        );
      }
      await this.recordTransition(transaction, {
        reservation: input.reservation,
        actorId: input.actorId,
        recipientId: input.reservation.requesterId,
        nextStatus: input.nextStatus,
        action: input.action,
        notificationType: input.notificationType,
        note: input.note,
        startAt: input.startAt,
        endAt: input.endAt,
        notificationExtra: input.notificationExtra,
      });
      return transaction.visitReservation.findUniqueOrThrow({
        where: { id: input.reservation.id },
        include: reservationInclude,
      });
    });
    return this.view(updated);
  }

  private async requesterTransition(input: {
    reservation: ReservationViewInput;
    actorId: string;
    expectedStatus: VisitReservationStatus;
    nextStatus: VisitReservationStatus;
    action: VisitReservationAction;
    notificationType: string;
    note: string;
    update: Prisma.VisitReservationUpdateManyMutationInput;
    startAt: Date | null;
    endAt: Date | null;
    requireUnexpiredAlternative?: boolean;
    refundReason?: ReservationRefundReason;
  }) {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.visitReservation.updateMany({
        where: {
          id: input.reservation.id,
          requesterId: input.actorId,
          status: input.expectedStatus,
          ...(input.requireUnexpiredAlternative
            ? { alternativeExpiresAt: { gt: now } }
            : {}),
        },
        data: { ...input.update, status: input.nextStatus },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          '예약 상태가 변경되었거나 응답 기한이 지났습니다.',
        );
      }
      await this.recordTransition(transaction, {
        reservation: input.reservation,
        actorId: input.actorId,
        recipientId: input.reservation.brokerUserId,
        nextStatus: input.nextStatus,
        action: input.action,
        notificationType: input.notificationType,
        note: input.note,
        startAt: input.startAt,
        endAt: input.endAt,
      });
      if (input.refundReason) {
        await this.deposits.queueReservationRefund(
          transaction,
          input.reservation.id,
          input.actorId,
          input.refundReason,
        );
      }
      return transaction.visitReservation.findUniqueOrThrow({
        where: { id: input.reservation.id },
        include: reservationInclude,
      });
    });
    const refund = input.refundReason
      ? await this.deposits.processPendingReservationRefund(
          input.reservation.id,
        )
      : null;
    return {
      ...this.view(updated),
      ...(refund ? { deposit: refund } : {}),
    };
  }

  private async recordTransition(
    transaction: Prisma.TransactionClient,
    input: {
      reservation: ReservationViewInput;
      actorId: string;
      recipientId: string;
      nextStatus: VisitReservationStatus;
      action: VisitReservationAction;
      notificationType: string;
      note: string | null;
      startAt: Date | null;
      endAt: Date | null;
      notificationExtra?: Record<string, string>;
    },
  ) {
    await transaction.visitReservationHistory.create({
      data: {
        id: createId(),
        reservationId: input.reservation.id,
        actorId: input.actorId,
        action: input.action,
        previousStatus: input.reservation.status,
        nextStatus: input.nextStatus,
        note: input.note,
        startAt: input.startAt,
        endAt: input.endAt,
      },
    });
    await this.enqueue(
      transaction,
      input.recipientId,
      input.notificationType,
      input.reservation.id,
      {
        reservationNumber: input.reservation.reservationNumber,
        listingNumber: input.reservation.property.listingNumber,
        status: input.nextStatus,
        startAt: input.startAt?.toISOString() ?? null,
        endAt: input.endAt?.toISOString() ?? null,
        note: input.note,
        ...(input.notificationExtra ?? {}),
      },
    );
    await transaction.auditLog.create({
      data: {
        id: createId(),
        actorId: input.actorId,
        action: `VISIT_RESERVATION.${input.action}`,
        targetType: 'VisitReservation',
        targetId: input.reservation.id,
        reason: input.note,
        beforeData: { status: input.reservation.status },
        afterData: {
          status: input.nextStatus,
          startAt: input.startAt?.toISOString() ?? null,
          endAt: input.endAt?.toISOString() ?? null,
        },
      },
    });
  }

  private enqueue(
    transaction: Prisma.TransactionClient,
    recipientUserId: string,
    type: string,
    reservationId: string,
    payload: Prisma.InputJsonObject,
  ) {
    return transaction.notificationOutbox.create({
      data: {
        id: createId(),
        recipientUserId,
        type,
        aggregateType: 'VisitReservation',
        aggregateId: reservationId,
        payload,
      },
    });
  }

  private async forBroker(reservationId: string, brokerUserId: string) {
    const reservation = await this.prisma.visitReservation.findFirst({
      where: { id: reservationId, brokerUserId },
      include: reservationInclude,
    });
    if (!reservation) {
      throw new NotFoundException('관리할 방문 예약을 찾을 수 없습니다.');
    }
    return reservation;
  }

  private async forRequester(reservationId: string, requesterId: string) {
    const reservation = await this.prisma.visitReservation.findFirst({
      where: { id: reservationId, requesterId },
      include: reservationInclude,
    });
    if (!reservation) {
      throw new NotFoundException('방문 예약을 찾을 수 없습니다.');
    }
    return reservation;
  }

  private async assertBrokerAvailability(
    brokerUserId: string,
    startAt: Date,
    endAt: Date,
    excludeId: string,
  ) {
    const conflict = await this.prisma.visitReservation.findFirst({
      where: {
        id: { not: excludeId },
        brokerUserId,
        status: VisitReservationStatus.CONFIRMED,
        confirmedStartAt: { lt: endAt },
        confirmedEndAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException(
        '해당 시간에 이미 확정된 다른 방문 예약이 있습니다.',
      );
    }
  }

  private findRequesterConflict(
    requesterId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
  ) {
    return this.prisma.visitReservation.findFirst({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        requesterId,
        OR: [
          {
            status: VisitReservationStatus.REQUESTED,
            requestedStartAt: { lt: endAt },
            requestedEndAt: { gt: startAt },
          },
          {
            status: VisitReservationStatus.ALTERNATIVE_PROPOSED,
            alternativeStartAt: { lt: endAt },
            alternativeEndAt: { gt: startAt },
          },
          {
            status: VisitReservationStatus.CONFIRMED,
            confirmedStartAt: { lt: endAt },
            confirmedEndAt: { gt: startAt },
          },
        ],
      },
      select: { id: true },
    });
  }

  private visitWindow(startValue: string, endValue: string) {
    const startAt = new Date(startValue);
    const endAt = new Date(endValue);
    const now = Date.now();
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt <= startAt
    ) {
      throw new BadRequestException('방문 시작·종료 시간이 올바르지 않습니다.');
    }
    const durationMinutes =
      (endAt.getTime() - startAt.getTime()) / (60 * 1_000);
    if (durationMinutes < 30 || durationMinutes > 180) {
      throw new BadRequestException(
        '방문 시간은 30분 이상 3시간 이하여야 합니다.',
      );
    }
    if (startAt.getTime() < now + 2 * 60 * 60 * 1_000) {
      throw new BadRequestException('방문은 최소 2시간 전에 요청해야 합니다.');
    }
    if (startAt.getTime() > now + 90 * 24 * 60 * 60 * 1_000) {
      throw new BadRequestException('방문은 90일 이내로 요청해야 합니다.');
    }
    return { startAt, endAt };
  }

  private reservationNumber(id: string): string {
    return `VR-${new Date().getUTCFullYear()}-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  private optionalText(value: string | undefined): string | null {
    const text = value?.trim();
    return text ? text : null;
  }

  private prismaCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code?: unknown }).code);
    }
    return undefined;
  }

  private view(reservation: ReservationViewInput) {
    return {
      id: reservation.id,
      reservationNumber: reservation.reservationNumber,
      status: reservation.status,
      property: reservation.property,
      requester: {
        memberNumber: reservation.requester.memberNumber,
        displayName: reservation.requester.profile?.displayName ?? null,
      },
      broker: {
        memberNumber: reservation.broker.memberNumber,
        displayName: reservation.broker.profile?.displayName ?? null,
      },
      requestedWindow: {
        startAt: reservation.requestedStartAt.toISOString(),
        endAt: reservation.requestedEndAt.toISOString(),
      },
      alternativeWindow:
        reservation.alternativeStartAt && reservation.alternativeEndAt
          ? {
              startAt: reservation.alternativeStartAt.toISOString(),
              endAt: reservation.alternativeEndAt.toISOString(),
              expiresAt:
                reservation.alternativeExpiresAt?.toISOString() ?? null,
            }
          : null,
      confirmedWindow:
        reservation.confirmedStartAt && reservation.confirmedEndAt
          ? {
              startAt: reservation.confirmedStartAt.toISOString(),
              endAt: reservation.confirmedEndAt.toISOString(),
            }
          : null,
      requestMessage: reservation.requestMessage,
      responseMessage: reservation.responseMessage,
      cancellationReason: reservation.cancellationReason,
      respondedAt: reservation.respondedAt?.toISOString() ?? null,
      cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
      autoConfirmed: false,
      paymentRequired: true,
      deposit: reservation.deposit
        ? this.deposits.view(reservation.deposit)
        : null,
      histories: reservation.histories.map((history) => ({
        id: history.id,
        actorMemberNumber: history.actor.memberNumber,
        action: history.action,
        previousStatus: history.previousStatus,
        nextStatus: history.nextStatus,
        note: history.note,
        startAt: history.startAt?.toISOString() ?? null,
        endAt: history.endAt?.toISOString() ?? null,
        createdAt: history.createdAt.toISOString(),
      })),
    };
  }
}
