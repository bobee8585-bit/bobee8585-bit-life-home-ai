import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId } from '../common/id';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../database/prisma.service';
import { PropertyStatus } from '../generated/prisma/client';

const MAX_ITEMS = 5;

@Injectable()
export class PropertyComparisonsService {
  constructor(private readonly prisma: PrismaService, private readonly currency: CurrencyService) {}

  async add(userId: string, propertyId: string, replacePropertyId?: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, status: PropertyStatus.ACTIVE }, select: { id: true } });
    if (!property) throw new NotFoundException('공개 중인 매물을 찾을 수 없습니다.');
    const existing = await this.prisma.propertyComparisonItem.findUnique({ where: { userId_propertyId: { userId, propertyId } } });
    if (existing) return this.get(userId, 'KRW');
    const rows = await this.prisma.propertyComparisonItem.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } });
    let sortOrder = rows.length ? Math.max(...rows.map((row) => row.sortOrder)) + 1 : 0;
    if (rows.length >= MAX_ITEMS) {
      if (!replacePropertyId) throw new ConflictException('비교 매물은 최대 5개까지 담을 수 있습니다.');
      const replacement = rows.find((row) => row.propertyId === replacePropertyId);
      if (!replacement) throw new NotFoundException('교체할 비교 매물을 찾을 수 없습니다.');
      sortOrder = replacement.sortOrder;
      await this.prisma.propertyComparisonItem.delete({ where: { id: replacement.id } });
    }
    await this.prisma.propertyComparisonItem.create({ data: { id: createId(), userId, propertyId, sortOrder } });
    return this.get(userId, 'KRW');
  }

  async remove(userId: string, propertyId?: string) {
    const result = await this.prisma.propertyComparisonItem.deleteMany({ where: { userId, ...(propertyId ? { propertyId } : {}) } });
    return { deleted: result.count };
  }

  async get(userId: string, displayCurrency: string) {
    const rows = await this.prisma.propertyComparisonItem.findMany({
      where: { userId }, orderBy: { sortOrder: 'asc' },
      include: { property: { include: { media: { where: { isPublic: true }, orderBy: { sortOrder: 'asc' }, take: 1 } } } },
    });
    const items = await Promise.all(rows.map(async ({ property, sortOrder }) => {
      if (property.status !== PropertyStatus.ACTIVE) return { propertyId: property.id, sortOrder, available: false as const };
      const converted = await this.currency.convertAmounts({ price: property.price.toString(), deposit: property.deposit?.toString() ?? null, monthlyRent: property.monthlyRent?.toString() ?? null }, property.currency, displayCurrency);
      return {
        propertyId: property.id, sortOrder, available: true as const, listingNumber: property.listingNumber, title: property.title,
        propertyType: property.propertyType, transactionType: property.transactionType, dealStatus: property.dealStatus,
        location: { region1: property.region1, city: property.city },
        price: converted.amounts.price, deposit: converted.amounts.deposit, monthlyRent: converted.amounts.monthlyRent,
        currency: displayCurrency, exclusiveArea: property.exclusiveArea.toString(), rooms: property.rooms, bathrooms: property.bathrooms,
        floor: property.floor, thumbnailUrl: property.media[0]?.thumbnailUrl ?? property.media[0]?.url ?? null,
      };
    }));
    const available = items.filter((item): item is Extract<(typeof items)[number], { available: true }> => item.available);
    const priceValues = available.map((item) => Number(item.price)).filter(Number.isFinite);
    const areaValues = available.map((item) => Number(item.exclusiveArea)).filter(Number.isFinite);
    return {
      displayCurrency,
      items,
      highlights: {
        lowestPricePropertyIds: priceValues.length ? available.filter((item) => Number(item.price) === Math.min(...priceValues)).map((item) => item.propertyId) : [],
        largestAreaPropertyIds: areaValues.length ? available.filter((item) => Number(item.exclusiveArea) === Math.max(...areaValues)).map((item) => item.propertyId) : [],
      },
      limits: { maxItems: MAX_ITEMS },
    };
  }
}
