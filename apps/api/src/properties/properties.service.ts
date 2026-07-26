import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { PrismaService } from '../database/prisma.service';
import {
  BrokerageStatus,
  BrokerStatus,
  OwnershipVerificationStatus,
  PropertyListingType,
  PropertyMediaType,
  Prisma,
  PropertyStatus,
  PropertyTransactionType,
  PropertyType,
} from '../generated/prisma/client';
import type { CreatePropertyDto } from './dto/create-property.dto';
import type { ListPropertyReviewsDto } from './dto/list-property-reviews.dto';
import type { SearchPropertiesDto } from './dto/search-properties.dto';
import { CurrencyService } from '../currency/currency.service';

const propertyInclude = {
  brokerageOffice: { select: { id: true, name: true } },
  ownershipVerification: {
    select: {
      claimType: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      evidenceReferenceEncrypted: true,
    },
  },
  media: { orderBy: { sortOrder: 'asc' as const } },
} as const;

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly sensitiveData: SensitiveDataService,
  ) {}

  async create(userId: string, dto: CreatePropertyDto) {
    const listing = await this.resolveListingContext(userId, dto);
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
          brokerageOfficeId: listing.brokerageOfficeId,
          listingType: listing.listingType,
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
          ...(listing.ownershipVerification
            ? {
                ownershipVerification: {
                  create: {
                    id: createId(),
                    claimantUserId: userId,
                    ...listing.ownershipVerification,
                  },
                },
              }
            : {}),
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
            listingType: listing.listingType,
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
    this.validateTransaction(dto);
    this.validateMedia(dto.media);
    const existing = await this.prisma.property.findFirst({
      where: {
        id: propertyId,
        brokerUserId: userId,
        status: { in: [PropertyStatus.DRAFT, PropertyStatus.REJECTED] },
      },
      select: {
        id: true,
        status: true,
        listingType: true,
        ownershipVerification: { select: { id: true } },
      },
    });
    if (!existing) {
      throw new ConflictException(
        '초안 또는 반려 상태의 본인 매물만 수정할 수 있습니다.',
      );
    }
    if (dto.listingType && dto.listingType !== existing.listingType) {
      throw new ConflictException('등록 후 매물 등록 유형을 변경할 수 없습니다.');
    }
    if (existing.listingType === PropertyListingType.BROKERAGE) {
      if (dto.ownershipVerification) {
        throw new BadRequestException(
          '중개사 매물에는 직거래 소유 증빙을 제출할 수 없습니다.',
        );
      }
      await this.activeBroker(userId);
    } else {
      await this.assertPhoneVerified(userId);
    }
    const ownershipUpdate =
      existing.listingType === PropertyListingType.OWNER_DIRECT &&
      dto.ownershipVerification
        ? this.ownershipVerificationData(dto)
        : null;
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
          ...(ownershipUpdate
            ? {
                ownershipVerification: existing.ownershipVerification
                  ? {
                      update: {
                        ...ownershipUpdate,
                        status: OwnershipVerificationStatus.PENDING,
                        rejectionReason: null,
                        reviewedBy: null,
                        reviewedAt: null,
                      },
                    }
                  : {
                      create: {
                        id: createId(),
                        claimantUserId: userId,
                        ...ownershipUpdate,
                      },
                    },
              }
            : {}),
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
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, brokerUserId: userId },
      include: { media: true, ownershipVerification: true },
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
    if (property.listingType === PropertyListingType.BROKERAGE) {
      await this.activeBroker(userId);
    } else {
      await this.assertPhoneVerified(userId);
      if (
        property.ownershipVerification?.status !==
        OwnershipVerificationStatus.PENDING
      ) {
        throw new BadRequestException(
          '소유·위임 증빙을 새로 제출한 뒤 검수를 요청해야 합니다.',
        );
      }
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
      OR: [
        { listingType: PropertyListingType.BROKERAGE },
        {
          listingType: PropertyListingType.OWNER_DIRECT,
          ownershipVerification: {
            status: OwnershipVerificationStatus.VERIFIED,
          },
        },
      ],
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
      items: await Promise.all(
        rows.map(async (row) => ({
          ...this.view(row, true),
          ...(row.ownershipVerification
            ? {
                ownershipEvidenceReference:
                  this.sensitiveData.decrypt(
                    row.ownershipVerification
                      .evidenceReferenceEncrypted,
                  ),
              }
            : {}),
        })),
      ),
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
      const property = await transaction.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: {
          id: true, listingNumber: true, brokerUserId: true, listingType: true,
          city: true, propertyType: true, transactionType: true, currency: true,
          price: true, rooms: true,
        },
      });
      if (property.listingType === PropertyListingType.OWNER_DIRECT) {
        const ownershipChanged =
          await transaction.propertyOwnershipVerification.updateMany({
            where: {
              propertyId,
              status: OwnershipVerificationStatus.PENDING,
            },
            data: {
              status:
                nextStatus === PropertyStatus.ACTIVE
                  ? OwnershipVerificationStatus.VERIFIED
                  : OwnershipVerificationStatus.REJECTED,
              rejectionReason:
                nextStatus === PropertyStatus.REJECTED ? reason : null,
              reviewedBy: reviewerId,
              reviewedAt,
            },
          });
        if (ownershipChanged.count !== 1) {
          throw new ConflictException(
            '직거래 매물의 소유·위임 증빙이 검수 가능한 상태가 아닙니다.',
          );
        }
      }
      if (nextStatus === PropertyStatus.ACTIVE) {
        await this.enqueueNewListingAlerts(transaction, property);
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

  private async enqueueNewListingAlerts(
    transaction: Prisma.TransactionClient,
    property: {
      id: string; listingNumber: string; brokerUserId: string; city: string;
      propertyType: PropertyType; transactionType: PropertyTransactionType;
      currency: string; price: Prisma.Decimal; rooms: number;
    },
  ) {
    const matches = await transaction.savedPropertySearch.findMany({
      where: {
        alertsEnabled: true, userId: { not: property.brokerUserId },
        currency: property.currency,
        AND: [
          { OR: [{ city: null }, { city: { equals: property.city, mode: 'insensitive' } }] },
          { OR: [{ propertyType: null }, { propertyType: property.propertyType }] },
          { OR: [{ transactionType: null }, { transactionType: property.transactionType }] },
          { OR: [{ minPrice: null }, { minPrice: { lte: property.price } }] },
          { OR: [{ maxPrice: null }, { maxPrice: { gte: property.price } }] },
          { OR: [{ minRooms: null }, { minRooms: { lte: property.rooms } }] },
        ],
      },
      select: { id: true, userId: true },
    });
    if (matches.length === 0) return;
    const existing = await transaction.savedPropertyAlert.findMany({
      where: { propertyId: property.id, savedSearchId: { in: matches.map(({ id }) => id) } },
      select: { savedSearchId: true },
    });
    const alreadyAlerted = new Set(existing.map(({ savedSearchId }) => savedSearchId));
    const fresh = matches.filter(({ id }) => !alreadyAlerted.has(id));
    if (fresh.length === 0) return;
    await transaction.savedPropertyAlert.createMany({
      data: fresh.map((search) => ({
        id: createId(), savedSearchId: search.id, propertyId: property.id,
      })),
    });
    await transaction.notificationOutbox.createMany({
      data: fresh.map((search) => ({
        id: createId(), recipientUserId: search.userId,
        type: 'PROPERTY_NEW_LISTING_MATCH', aggregateType: 'Property',
        aggregateId: property.id,
        payload: {
          savedSearchId: search.id, propertyId: property.id,
          listingNumber: property.listingNumber,
        },
        smsFallbackAllowed: false,
      })),
    });
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

  private async resolveListingContext(
    userId: string,
    dto: CreatePropertyDto,
  ) {
    const listingType =
      dto.listingType ??
      (dto.ownershipVerification
        ? PropertyListingType.OWNER_DIRECT
        : PropertyListingType.BROKERAGE);
    if (listingType === PropertyListingType.BROKERAGE) {
      if (dto.ownershipVerification) {
        throw new BadRequestException(
          '중개사 매물에는 직거래 소유 증빙을 제출할 수 없습니다.',
        );
      }
      const broker = await this.activeBroker(userId);
      return {
        listingType,
        brokerageOfficeId: broker.brokerageOfficeId,
        ownershipVerification: null,
      };
    }
    await this.assertPhoneVerified(userId);
    if (!dto.ownershipVerification) {
      throw new BadRequestException(
        '직거래 매물은 소유자 또는 적법한 위임자 증빙이 필요합니다.',
      );
    }
    return {
      listingType,
      brokerageOfficeId: null,
      ownershipVerification: this.ownershipVerificationData(dto),
    };
  }

  private async assertPhoneVerified(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phoneVerifiedAt: true },
    });
    if (!user?.phoneVerifiedAt) {
      throw new ForbiddenException(
        '직거래 매물 등록 전 휴대폰 본인인증이 필요합니다.',
      );
    }
  }

  private ownershipVerificationData(dto: CreatePropertyDto) {
    const verification = dto.ownershipVerification;
    if (!verification) {
      throw new BadRequestException('소유·위임 증빙이 필요합니다.');
    }
    if (
      verification.ownershipDeclarationAccepted !== true ||
      verification.noBrokerageDeclarationAccepted !== true
    ) {
      throw new BadRequestException(
        '소유·위임 권한과 중개행위 금지 확인에 동의해야 합니다.',
      );
    }
    const evidenceReference = verification.evidenceReference.trim();
    const declaredAt = new Date();
    return {
      claimType: verification.claimType,
      evidenceReferenceEncrypted:
        this.sensitiveData.encrypt(evidenceReference),
      evidenceReferenceHash: this.sensitiveData.hash(evidenceReference),
      ownershipDeclarationAt: declaredAt,
      noBrokerageDeclarationAt: declaredAt,
    };
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
      listingType: PropertyListingType;
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
      brokerageOffice: { id: string; name: string } | null;
      ownershipVerification: {
        claimType: string;
        status: OwnershipVerificationStatus;
        rejectionReason: string | null;
        reviewedAt: Date | null;
        evidenceReferenceEncrypted: string;
      } | null;
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
      ...(includePrivate
        ? { registrantUserId: property.brokerUserId }
        : {}),
      listing: {
        type: property.listingType,
        badge:
          property.listingType === PropertyListingType.OWNER_DIRECT
            ? 'DIRECT_OWNER'
            : 'LICENSED_BROKER',
        brokerageFee:
          property.listingType === PropertyListingType.OWNER_DIRECT
            ? 'NONE'
            : 'APPLICABLE',
      },
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
      ...(includePrivate && property.ownershipVerification
        ? {
            ownershipVerification: {
              claimType: property.ownershipVerification.claimType,
              status: property.ownershipVerification.status,
              rejectionReason:
                property.ownershipVerification.rejectionReason,
              reviewedAt:
                property.ownershipVerification.reviewedAt?.toISOString() ??
                null,
            },
          }
        : {}),
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
