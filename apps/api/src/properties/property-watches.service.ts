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
  OwnershipVerificationStatus,
  Prisma,
  PropertyChangeType,
  PropertyListingType,
  PropertyMediaType,
  PropertyStatus,
} from '../generated/prisma/client';
import type { UpdatePropertyWatchDto } from './dto/update-property-watch.dto';

const MAX_PROPERTY_WATCHES = 200;

const watchedPropertySelect = {
  id: true,
  listingNumber: true,
  brokerUserId: true,
  title: true,
  price: true,
  currency: true,
  status: true,
  dealStatus: true,
  media: {
    where: { type: PropertyMediaType.IMAGE, isPublic: true },
    select: { thumbnailUrl: true, url: true },
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
  },
} as const;

@Injectable()
export class PropertyWatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.propertyWatch.findMany({
      where: { userId },
      include: { property: { select: watchedPropertySelect } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.view(row));
  }

  async create(userId: string, propertyId: string) {
    const id = createId();
    const created = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "users"
          WHERE "id" = ${userId}::uuid FOR UPDATE`,
      );
      const property = await transaction.property.findFirst({
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
        select: watchedPropertySelect,
      });
      if (!property) {
        throw new NotFoundException('공개 중인 매물을 찾을 수 없습니다.');
      }
      if (property.brokerUserId === userId) {
        throw new ForbiddenException('본인이 등록한 매물은 관심 매물로 저장할 수 없습니다.');
      }
      const duplicate = await transaction.propertyWatch.findUnique({
        where: { userId_propertyId: { userId, propertyId } },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('이미 관심 매물로 저장했습니다.');
      }
      const count = await transaction.propertyWatch.count({ where: { userId } });
      if (count >= MAX_PROPERTY_WATCHES) {
        throw new ConflictException(
          `관심 매물은 회원당 최대 ${MAX_PROPERTY_WATCHES}개까지 저장할 수 있습니다.`,
        );
      }
      const watch = await transaction.propertyWatch.create({
        data: { id, userId, propertyId },
        include: { property: { select: watchedPropertySelect } },
      });
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: userId,
          action: 'PROPERTY_WATCH.CREATE',
          targetType: 'PropertyWatch',
          targetId: id,
          afterData: { propertyId },
        },
      });
      return watch;
    });
    return this.view(created);
  }

  async update(userId: string, id: string, dto: UpdatePropertyWatchDto) {
    const data = {
      ...(dto.alertOnPriceChange !== undefined
        ? { alertOnPriceChange: dto.alertOnPriceChange }
        : {}),
      ...(dto.alertOnPhotoChange !== undefined
        ? { alertOnPhotoChange: dto.alertOnPhotoChange }
        : {}),
      ...(dto.alertOnDealStatusChange !== undefined
        ? { alertOnDealStatusChange: dto.alertOnDealStatusChange }
        : {}),
    };
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('변경할 알림 설정이 필요합니다.');
    }
    const existing = await this.prisma.propertyWatch.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('관심 매물을 찾을 수 없습니다.');
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.propertyWatch.update({
        where: { id },
        data,
        include: { property: { select: watchedPropertySelect } },
      });
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: userId,
          action: 'PROPERTY_WATCH.UPDATE',
          targetType: 'PropertyWatch',
          targetId: id,
          beforeData: this.alertSettings(existing),
          afterData: this.alertSettings(row),
        },
      });
      return row;
    });
    return this.view(updated);
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.propertyWatch.findFirst({
      where: { id, userId },
      select: { id: true, propertyId: true },
    });
    if (!existing) {
      throw new NotFoundException('관심 매물을 찾을 수 없습니다.');
    }
    await this.prisma.$transaction([
      this.prisma.propertyWatch.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          id: createId(),
          actorId: userId,
          action: 'PROPERTY_WATCH.DELETE',
          targetType: 'PropertyWatch',
          targetId: id,
          beforeData: { propertyId: existing.propertyId },
        },
      }),
    ]);
    return { id, deleted: true };
  }

  async changes(userId: string, id: string) {
    const watch = await this.prisma.propertyWatch.findFirst({
      where: { id, userId },
      select: { propertyId: true },
    });
    if (!watch) {
      throw new NotFoundException('관심 매물을 찾을 수 없습니다.');
    }
    const rows = await this.prisma.propertyChangeEvent.findMany({
      where: { propertyId: watch.propertyId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      before: row.beforeData,
      after: row.afterData,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async recordChange(
    transaction: Prisma.TransactionClient,
    input: {
      propertyId: string;
      listingNumber: string;
      actorUserId: string;
      type: PropertyChangeType;
      before: Prisma.InputJsonValue;
      after: Prisma.InputJsonValue;
    },
  ) {
    const eventId = createId();
    await transaction.propertyChangeEvent.create({
      data: {
        id: eventId,
        propertyId: input.propertyId,
        actorUserId: input.actorUserId,
        type: input.type,
        beforeData: input.before,
        afterData: input.after,
      },
    });
    const alertField =
      input.type === PropertyChangeType.PRICE
        ? 'alertOnPriceChange'
        : input.type === PropertyChangeType.PHOTO
          ? 'alertOnPhotoChange'
          : 'alertOnDealStatusChange';
    const watches = await transaction.propertyWatch.findMany({
      where: { propertyId: input.propertyId, [alertField]: true },
      select: { id: true, userId: true },
    });
    if (watches.length === 0) {
      return eventId;
    }
    await transaction.propertyWatchAlert.createMany({
      data: watches.map((watch) => ({
        id: createId(),
        propertyWatchId: watch.id,
        changeEventId: eventId,
      })),
      skipDuplicates: true,
    });
    await transaction.notificationOutbox.createMany({
      data: watches.map((watch) => ({
        id: createId(),
        recipientUserId: watch.userId,
        type: this.notificationType(input.type),
        aggregateType: 'Property',
        aggregateId: input.propertyId,
        payload: {
          propertyId: input.propertyId,
          listingNumber: input.listingNumber,
          changeEventId: eventId,
          changeType: input.type,
        },
        smsFallbackAllowed: false,
      })),
    });
    return eventId;
  }

  private notificationType(type: PropertyChangeType): string {
    if (type === PropertyChangeType.PRICE) return 'PROPERTY_PRICE_CHANGED';
    if (type === PropertyChangeType.PHOTO) return 'PROPERTY_PHOTO_CHANGED';
    return 'PROPERTY_DEAL_STATUS_CHANGED';
  }

  private alertSettings(row: {
    alertOnPriceChange: boolean;
    alertOnPhotoChange: boolean;
    alertOnDealStatusChange: boolean;
  }) {
    return {
      alertOnPriceChange: row.alertOnPriceChange,
      alertOnPhotoChange: row.alertOnPhotoChange,
      alertOnDealStatusChange: row.alertOnDealStatusChange,
    };
  }

  private view(row: {
    id: string;
    alertOnPriceChange: boolean;
    alertOnPhotoChange: boolean;
    alertOnDealStatusChange: boolean;
    createdAt: Date;
    updatedAt: Date;
    property: {
      id: string;
      listingNumber: string;
      brokerUserId: string;
      title: string;
      price: { toString(): string };
      currency: string;
      status: PropertyStatus;
      dealStatus: string;
      media: Array<{ thumbnailUrl: string | null; url: string }>;
    };
  }) {
    const image = row.property.media[0];
    return {
      id: row.id,
      alerts: this.alertSettings(row),
      property: {
        id: row.property.id,
        listingNumber: row.property.listingNumber,
        title: row.property.title,
        price: row.property.price.toString(),
        currency: row.property.currency,
        publicationStatus: row.property.status,
        dealStatus: row.property.dealStatus,
        thumbnailUrl: image?.thumbnailUrl ?? image?.url ?? null,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
