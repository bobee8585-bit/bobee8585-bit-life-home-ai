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
  BrokerageStatus,
  BrokerStatus,
  PropertyMediaType,
  PropertyStatus,
  PropertyTransactionType,
} from '../generated/prisma/client';
import type { CreatePropertyDto } from './dto/create-property.dto';
import type { ListPropertyReviewsDto } from './dto/list-property-reviews.dto';
import type { SearchPropertiesDto } from './dto/search-properties.dto';
import { CurrencyService } from '../currency/currency.service';

const propertyInclude = {
  brokerageOffice: { select: { id: true, name: true } },
  media: { orderBy: { sortOrder: 'asc' as const } },
} as const;

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async create(userId: string, dto: CreatePropertyDto) {
    const broker = await this.activeBroker(userId);
    this.validateTransaction(dto);
    this.validateMedia(dto.media);
    const id = createId();
    const listingNumber = this.listingNumber(id);
    const property = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.property.create({
        data: {
          id,
          listingNumber,
          brokerUserId: userId,
          brokerageOfficeId: broker.brokerageOfficeId,
          title: dto.title.trim(),
          description: dto.description.trim(),
          propertyType: dto.propertyType,
          transactionType: dto.transactionType,
          price: dto.price,
          deposit: dto.deposit,
          monthlyRent: dto.monthlyRent,
          currency: dto.currency.toUpperCase(),
          exclusiveArea: dto.exclusiveArea,
          supplyArea: dto.supplyArea,
          rooms: dto.rooms,
          bathrooms: dto.bathrooms,
          floor: dto.floor,
          totalFloors: dto.totalFloors,
          countryCode: dto.countryCode.toUpperCase(),
          region1: dto.region1.trim(),
          region2: dto.region2?.trim(),
          city: dto.city.trim(),
          addressLine1: dto.addressLine1.trim(),
          addressLine2: dto.addressLine2?.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          media: {
            create: dto.media.map((media) => ({
              id: createId(),
              type: media.type,
              url: media.url,
              thumbnailUrl: media.thumbnailUrl,
              sortOrder: media.sortOrder,
              isPublic: media.isPublic,
            })),
          },
        },
        include: propertyInclude,
      });
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: userId,
          action: 'PROPERTY.CREATE',
          targetType: 'Property',
          targetId: id,
          afterData: {
            listingNumber,
            status: PropertyStatus.DRAFT,
          },
        },
      });
      return created;
    });
    return this.view(property, true);
  }

  async mine(userId: string) {
    const rows = await this.prisma.property.findMany({
      where: { brokerUserId: userId },
      include: propertyInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.view(row, true));
  }

  async update(userId: string, propertyId: string, dto: CreatePropertyDto) {
    await this.activeBroker(userId);
    this.validateTransaction(dto);
    this.validateMedia(dto.media);
    const existing = await this.prisma.property.findFirst({
      where: {
        id: propertyId,
        brokerUserId: userId,
        status: { in: [PropertyStatus.DRAFT, PropertyStatus.REJECTED] },
      },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new ConflictException(
        '초안 또는 반려 상태의 본인 매물만 수정할 수 있습니다.',
      );
    }
    const property = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.property.update({
        where: { id: propertyId },
        data: {
          title: dto.title.trim(),
          description: dto.description.trim(),
          propertyType: dto.propertyType,
          transactionType: dto.transactionType,
          price: dto.price,
          deposit: dto.deposit,
          monthlyRent: dto.monthlyRent,
          currency: dto.currency.toUpperCase(),
          exclusiveArea: dto.exclusiveArea,
          supplyArea: dto.supplyArea,
          rooms: dto.rooms,
          bathrooms: dto.bathrooms,
          floor: dto.floor,
          totalFloors: dto.totalFloors,
          countryCode: dto.countryCode.toUpperCase(),
          region1: dto.region1.trim(),
          region2: dto.region2?.trim(),
          city: dto.city.trim(),
          addressLine1: dto.addressLine1.trim(),
          addressLine2: dto.addressLine2?.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          status: PropertyStatus.DRAFT,
          rejectionReason: null,
          media: {
            deleteMany: {},
            create: dto.media.map((media) => ({
              id: createId(),
              type: media.type,
              url: media.url,
              thumbnailUrl: media.thumbnailUrl,
              sortOrder: media.sortOrder,
              isPublic: media.isPublic,
            })),
          },
        },
        include: propertyInclude,
      });
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: userId,
          action: 'PROPERTY.UPDATE',
          targetType: 'Property',
          targetId: propertyId,
          beforeData: { status: existing.status },
          afterData: { status: PropertyStatus.DRAFT },
        },
      });
      return updated;
    });
    return this.view(property, true);
  }

  async submit(userId: string, propertyId: string) {
    await this.activeBroker(userId);
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, brokerUserId: userId },
      include: { media: true },
    });
    if (!property) {
      throw new NotFoundException('매물을 찾을 수 없습니다.');
    }
    if (
      property.status !== PropertyStatus.DRAFT &&
      property.status !== PropertyStatus.REJECTED
    ) {
      throw new ConflictException('현재 상태에서는 검수를 요청할 수 없습니다.');
    }
    if (
      !property.media.some(
        (media) =>
          media.type === PropertyMediaType.IMAGE && media.isPublic,
      )
    ) {
      throw new BadRequestException('공개 이미지가 최소 1개 필요합니다.');
    }
    const submittedAt = new Date();
    const updated = await this.prisma.property.updateMany({
      where: {
        id: propertyId,
        brokerUserId: userId,
        status: { in: [PropertyStatus.DRAFT, PropertyStatus.REJECTED] },
      },
      data: {
        status: PropertyStatus.PENDING_REVIEW,
        submittedAt,
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('매물 상태가 변경되어 다시 확인해야 합니다.');
    }
    await this.prisma.auditLog.create({
      data: {
        id: createId(),
        actorId: userId,
        action: 'PROPERTY.SUBMIT',
        targetType: 'Property',
        targetId: propertyId,
        afterData: { status: PropertyStatus.PENDING_REVIEW },
      },
    });
    return {
      id: propertyId,
      status: PropertyStatus.PENDING_REVIEW,
      submittedAt: submittedAt.toISOString(),
    };
  }

  async search(query: SearchPropertiesDto) {
    const where = {
      status: PropertyStatus.ACTIVE,
      ...(query.city
        ? { city: { contains: query.city.trim(), mode: 'insensitive' as const } }
        : {}),
      ...(query.propertyType ? { propertyType: query.propertyType } : {}),
      ...(query.transactionType
        ? { transactionType: query.transactionType }
        : {}),
      ...(query.minRooms !== undefined
        ? { rooms: { gte: query.minRooms } }
        : {}),
      ...(query.minPrice || query.maxPrice
        ? {
            price: {
              ...(query.minPrice ? { gte: query.minPrice } : {}),
              ...(query.maxPrice ? { lte: query.maxPrice } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        where,
        include: propertyInclude,
        orderBy: [{ activatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.property.count({ where }),
    ]);
    return {
      items: await Promise.all(
        rows.map((row) => this.publicView(row, query.displayCurrency)),
      ),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async detail(propertyId: string, displayCurrency = 'KRW') {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, status: PropertyStatus.ACTIVE },
      include: propertyInclude,
    });
    if (!property) {
      throw new NotFoundException('공개 중인 매물을 찾을 수 없습니다.');
    }
    return this.publicView(property, displayCurrency);
  }

  async reviewQueue(query: ListPropertyReviewsDto) {
    const where = { status: query.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        where,
        include: propertyInclude,
        orderBy: { submittedAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.property.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.view(row, true)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async approve(propertyId: string, reviewerId: string, reason: string) {
    return this.review(
      propertyId,
      reviewerId,
      reason,
      PropertyStatus.ACTIVE,
    );
  }

  async reject(propertyId: string, reviewerId: string, reason: string) {
    return this.review(
      propertyId,
      reviewerId,
      reason,
      PropertyStatus.REJECTED,
    );
  }

  private async review(
    propertyId: string,
    reviewerId: string,
    reason: string,
    nextStatus: PropertyStatus,
  ) {
    const reviewedAt = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.property.updateMany({
        where: {
          id: propertyId,
          status: PropertyStatus.PENDING_REVIEW,
        },
        data: {
          status: nextStatus,
          reviewedBy: reviewerId,
          reviewedAt,
          activatedAt:
            nextStatus === PropertyStatus.ACTIVE ? reviewedAt : undefined,
          rejectionReason:
            nextStatus === PropertyStatus.REJECTED ? reason : null,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          '검수 대기 중인 매물이 아니거나 이미 처리되었습니다.',
        );
      }
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: reviewerId,
          action:
            nextStatus === PropertyStatus.ACTIVE
              ? 'PROPERTY.APPROVE'
              : 'PROPERTY.REJECT',
          targetType: 'Property',
          targetId: propertyId,
          reason,
          beforeData: { status: PropertyStatus.PENDING_REVIEW },
          afterData: { status: nextStatus },
        },
      });
      return transaction.property.findUniqueOrThrow({
        where: { id: propertyId },
        include: propertyInclude,
      });
    });
    return this.view(updated, true);
  }

  private async activeBroker(userId: string) {
    const broker = await this.prisma.brokerProfile.findFirst({
      where: {
        userId,
        status: BrokerStatus.ACTIVE,
        brokerageOffice: { status: BrokerageStatus.ACTIVE },
      },
      select: { brokerageOfficeId: true },
    });
    if (!broker) {
      throw new ForbiddenException(
        '승인된 중개사와 활성 중개사무소만 매물을 등록할 수 있습니다.',
      );
    }
    return broker;
  }

  private validateTransaction(dto: CreatePropertyDto): void {
    const price = Number(dto.price);
    const deposit = dto.deposit === undefined ? undefined : Number(dto.deposit);
    const monthlyRent =
      dto.monthlyRent === undefined ? undefined : Number(dto.monthlyRent);
    if (![price, deposit, monthlyRent].every((value) => value === undefined || (Number.isFinite(value) && value >= 0))) {
      throw new BadRequestException('금액은 0 이상의 숫자여야 합니다.');
    }
    if (
      dto.transactionType === PropertyTransactionType.SALE &&
      price <= 0
    ) {
      throw new BadRequestException('매매가는 0보다 커야 합니다.');
    }
    if (
      dto.transactionType === PropertyTransactionType.JEONSE &&
      price <= 0
    ) {
      throw new BadRequestException('전세 보증금은 0보다 커야 합니다.');
    }
    if (
      dto.transactionType === PropertyTransactionType.MONTHLY_RENT &&
      (!monthlyRent || monthlyRent <= 0)
    ) {
      throw new BadRequestException('월세 금액은 0보다 커야 합니다.');
    }
  }

  private validateMedia(media: CreatePropertyDto['media']): void {
    const images = media.filter(
      (item) => item.type === PropertyMediaType.IMAGE,
    );
    const videos = media.filter(
      (item) => item.type === PropertyMediaType.VIDEO,
    );
    if (images.length > 20) {
      throw new BadRequestException('이미지는 최대 20개까지 등록할 수 있습니다.');
    }
    if (videos.length > 3) {
      throw new BadRequestException('동영상은 최대 3개까지 등록할 수 있습니다.');
    }
    if (images.filter((item) => item.isPublic).length > 10) {
      throw new BadRequestException('공개 이미지는 최대 10개입니다.');
    }
    if (videos.filter((item) => item.isPublic).length > 1) {
      throw new BadRequestException('공개 동영상은 최대 1개입니다.');
    }
  }

  private listingNumber(id: string): string {
    return `LH-${new Date().getUTCFullYear()}-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  private view(
    property: {
      id: string;
      listingNumber: string;
      brokerUserId: string;
      title: string;
      description: string;
      propertyType: string;
      transactionType: string;
      price: { toString(): string };
      deposit: { toString(): string } | null;
      monthlyRent: { toString(): string } | null;
      currency: string;
      exclusiveArea: { toString(): string };
      supplyArea: { toString(): string } | null;
      rooms: number;
      bathrooms: number;
      floor: number | null;
      totalFloors: number | null;
      countryCode: string;
      region1: string;
      region2: string | null;
      city: string;
      addressLine1: string;
      addressLine2: string | null;
      latitude: { toString(): string } | null;
      longitude: { toString(): string } | null;
      status: PropertyStatus;
      rejectionReason: string | null;
      submittedAt: Date | null;
      activatedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      brokerageOffice: { id: string; name: string };
      media: Array<{
        id: string;
        type: PropertyMediaType;
        url: string;
        thumbnailUrl: string | null;
        sortOrder: number;
        isPublic: boolean;
      }>;
    },
    includePrivate: boolean,
  ) {
    const media = includePrivate
      ? property.media
      : property.media.filter((item) => item.isPublic);
    return {
      id: property.id,
      listingNumber: property.listingNumber,
      ...(includePrivate ? { brokerUserId: property.brokerUserId } : {}),
      title: property.title,
      description: property.description,
      propertyType: property.propertyType,
      transactionType: property.transactionType,
      price: property.price.toString(),
      deposit: property.deposit?.toString() ?? null,
      monthlyRent: property.monthlyRent?.toString() ?? null,
      currency: property.currency,
      exclusiveArea: property.exclusiveArea.toString(),
      supplyArea: property.supplyArea?.toString() ?? null,
      rooms: property.rooms,
      bathrooms: property.bathrooms,
      floor: property.floor,
      totalFloors: property.totalFloors,
      location: {
        countryCode: property.countryCode,
        region1: property.region1,
        region2: property.region2,
        city: property.city,
        addressLine1: property.addressLine1,
        addressLine2: property.addressLine2,
        latitude: property.latitude?.toString() ?? null,
        longitude: property.longitude?.toString() ?? null,
      },
      brokerageOffice: property.brokerageOffice,
      status: property.status,
      ...(includePrivate
        ? {
            rejectionReason: property.rejectionReason,
            submittedAt: property.submittedAt?.toISOString() ?? null,
          }
        : {}),
      activatedAt: property.activatedAt?.toISOString() ?? null,
      createdAt: property.createdAt.toISOString(),
      updatedAt: property.updatedAt.toISOString(),
      media: media.map((item) => ({
        id: item.id,
        type: item.type,
        url:
          includePrivate && item.url.startsWith('/v1/media/')
            ? `${item.url}/preview`
            : item.url,
        thumbnailUrl:
          includePrivate &&
          item.thumbnailUrl?.startsWith('/v1/media/')
            ? `${item.thumbnailUrl}/preview`
            : item.thumbnailUrl,
        sortOrder: item.sortOrder,
        ...(includePrivate ? { isPublic: item.isPublic } : {}),
      })),
    };
  }

  private async publicView(
    property: Parameters<PropertiesService['view']>[0],
    displayCurrency: string,
  ) {
    const base = this.view(property, false);
    const converted = await this.currency.convertAmounts(
      {
        price: base.price,
        deposit: base.deposit,
        monthlyRent: base.monthlyRent,
      },
      base.currency,
      displayCurrency,
    );
    return {
      ...base,
      displayPrice: {
        currency: converted.exchangeRate.quoteCurrency,
        price: converted.amounts.price,
        deposit: converted.amounts.deposit,
        monthlyRent: converted.amounts.monthlyRent,
        sourceCurrency: converted.exchangeRate.baseCurrency,
        rate: converted.exchangeRate.rate,
        sourceTimestamp: converted.exchangeRate.sourceTimestamp,
        isStale: converted.exchangeRate.isStale,
        usage: 'DISPLAY_ONLY' as const,
      },
    };
  }
}
