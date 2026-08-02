import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import { PropertyStatus, Prisma } from '../generated/prisma/client';

const VIEW_LIMIT = 100;
const SEARCH_LIMIT = 50;
const RETENTION_DAYS = 90;

@Injectable()
export class PropertyBrowsingService {
  constructor(private readonly prisma: PrismaService) {}

  async recordView(userId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, status: PropertyStatus.ACTIVE },
      select: { id: true },
    });
    if (!property) throw new NotFoundException('공개 중인 매물을 찾을 수 없습니다.');
    const viewedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.recentPropertyView.upsert({
        where: { userId_propertyId: { userId, propertyId } },
        create: { id: createId(), userId, propertyId, viewedAt },
        update: { viewedAt },
      });
      await this.trimViews(tx, userId);
    });
    return { propertyId, viewedAt: viewedAt.toISOString() };
  }

  async views(userId: string) {
    await this.purge(userId);
    const rows = await this.prisma.recentPropertyView.findMany({
      where: { userId }, orderBy: { viewedAt: 'desc' }, take: VIEW_LIMIT,
      include: { property: { select: { id: true, listingNumber: true, title: true, city: true, status: true, dealStatus: true, price: true, currency: true, media: { where: { isPublic: true }, orderBy: { sortOrder: 'asc' }, take: 1, select: { thumbnailUrl: true, url: true } } } } },
    });
    return rows.map(({ property, viewedAt }) => property.status === PropertyStatus.ACTIVE ? {
      viewedAt: viewedAt.toISOString(), property: { ...property, price: property.price.toString(), thumbnailUrl: property.media[0]?.thumbnailUrl ?? property.media[0]?.url ?? null, media: undefined },
    } : { viewedAt: viewedAt.toISOString(), property: { id: property.id, available: false } });
  }

  async clearViews(userId: string, propertyId?: string) {
    const result = await this.prisma.recentPropertyView.deleteMany({ where: { userId, ...(propertyId ? { propertyId } : {}) } });
    return { deleted: result.count };
  }

  async recordSearch(userId: string, criteria: Record<string, unknown>) {
    const normalized = this.normalize(criteria);
    const signature = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const searchedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.recentPropertySearch.upsert({
        where: { userId_signature: { userId, signature } },
        create: { id: createId(), userId, signature, criteria: normalized as Prisma.InputJsonValue, searchedAt },
        update: { criteria: normalized as Prisma.InputJsonValue, searchedAt },
      });
      const stale = await tx.recentPropertySearch.findMany({ where: { userId }, orderBy: { searchedAt: 'desc' }, skip: SEARCH_LIMIT, select: { id: true } });
      if (stale.length) await tx.recentPropertySearch.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    });
    return { signature, criteria: normalized, searchedAt: searchedAt.toISOString() };
  }

  async searches(userId: string) {
    await this.purge(userId);
    const rows = await this.prisma.recentPropertySearch.findMany({ where: { userId }, orderBy: { searchedAt: 'desc' }, take: SEARCH_LIMIT });
    return rows.map((row) => ({ id: row.id, signature: row.signature, criteria: row.criteria, searchedAt: row.searchedAt.toISOString() }));
  }

  async clearSearches(userId: string, id?: string) {
    const result = await this.prisma.recentPropertySearch.deleteMany({ where: { userId, ...(id ? { id } : {}) } });
    return { deleted: result.count };
  }

  async continue(userId: string) {
    const [views, searches] = await Promise.all([this.views(userId), this.searches(userId)]);
    return { lastViewed: views[0] ?? null, lastSearch: searches[0] ?? null };
  }

  private normalize(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '').sort(([a], [b]) => a.localeCompare(b)));
  }

  private async purge(userId: string) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
    await this.prisma.$transaction([
      this.prisma.recentPropertyView.deleteMany({ where: { userId, viewedAt: { lt: cutoff } } }),
      this.prisma.recentPropertySearch.deleteMany({ where: { userId, searchedAt: { lt: cutoff } } }),
    ]);
  }

  private async trimViews(tx: Prisma.TransactionClient, userId: string) {
    const stale = await tx.recentPropertyView.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, skip: VIEW_LIMIT, select: { id: true } });
    if (stale.length) await tx.recentPropertyView.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
}
