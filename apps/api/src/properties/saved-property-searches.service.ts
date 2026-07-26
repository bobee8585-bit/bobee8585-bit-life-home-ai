import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { CreateSavedPropertySearchDto } from './dto/create-saved-property-search.dto';
import type { UpdateSavedPropertySearchDto } from './dto/update-saved-property-search.dto';

const MAX_SAVED_SEARCHES = 20;

@Injectable()
export class SavedPropertySearchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.savedPropertySearch.findMany({
      where: { userId }, orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.view(row));
  }

  async create(userId: string, dto: CreateSavedPropertySearchDto) {
    const data = this.createData(dto);
    const [count, duplicate] = await this.prisma.$transaction([
      this.prisma.savedPropertySearch.count({ where: { userId } }),
      this.prisma.savedPropertySearch.findUnique({
        where: { userId_name: { userId, name: data.name } }, select: { id: true },
      }),
    ]);
    if (count >= MAX_SAVED_SEARCHES) {
      throw new ConflictException(`저장 검색은 회원당 최대 ${MAX_SAVED_SEARCHES}개까지 만들 수 있습니다.`);
    }
    if (duplicate) throw new ConflictException('같은 이름의 저장 검색이 이미 있습니다.');

    const id = createId();
    const created = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.savedPropertySearch.create({
        data: { id, userId, ...data },
      });
      await transaction.auditLog.create({
        data: {
          id: createId(), actorId: userId, action: 'SAVED_PROPERTY_SEARCH.CREATE',
          targetType: 'SavedPropertySearch', targetId: id,
          afterData: { alertsEnabled: row.alertsEnabled },
        },
      });
      return row;
    });
    return this.view(created);
  }

  async update(userId: string, id: string, dto: UpdateSavedPropertySearchDto) {
    const existing = await this.prisma.savedPropertySearch.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('저장 검색을 찾을 수 없습니다.');
    const data = this.updateData(dto, existing);
    if (data.name && data.name !== existing.name) {
      const duplicate = await this.prisma.savedPropertySearch.findUnique({
        where: { userId_name: { userId, name: data.name } }, select: { id: true },
      });
      if (duplicate) throw new ConflictException('같은 이름의 저장 검색이 이미 있습니다.');
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.savedPropertySearch.update({ where: { id }, data });
      await transaction.auditLog.create({
        data: {
          id: createId(), actorId: userId, action: 'SAVED_PROPERTY_SEARCH.UPDATE',
          targetType: 'SavedPropertySearch', targetId: id,
          beforeData: { alertsEnabled: existing.alertsEnabled },
          afterData: { alertsEnabled: row.alertsEnabled },
        },
      });
      return row;
    });
    return this.view(updated);
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.savedPropertySearch.findFirst({
      where: { id, userId }, select: { id: true, alertsEnabled: true },
    });
    if (!existing) throw new NotFoundException('저장 검색을 찾을 수 없습니다.');
    await this.prisma.$transaction([
      this.prisma.savedPropertySearch.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          id: createId(), actorId: userId, action: 'SAVED_PROPERTY_SEARCH.DELETE',
          targetType: 'SavedPropertySearch', targetId: id,
          beforeData: { alertsEnabled: existing.alertsEnabled },
        },
      }),
    ]);
    return { id, deleted: true };
  }

  private createData(dto: CreateSavedPropertySearchDto) {
    const data = {
      name: dto.name.trim(), city: dto.city?.trim() || null,
      propertyType: dto.propertyType ?? null,
      transactionType: dto.transactionType ?? null,
      currency: dto.currency.toUpperCase(), minPrice: dto.minPrice ?? null,
      maxPrice: dto.maxPrice ?? null, minRooms: dto.minRooms ?? null,
      alertsEnabled: dto.alertsEnabled,
    };
    this.validatePrices(data.minPrice, data.maxPrice);
    return data;
  }

  private updateData(dto: UpdateSavedPropertySearchDto,
    existing: { name: string; minPrice: Prisma.Decimal | null; maxPrice: Prisma.Decimal | null }) {
    const minPrice = dto.minPrice === undefined ? existing.minPrice?.toString() ?? null : dto.minPrice;
    const maxPrice = dto.maxPrice === undefined ? existing.maxPrice?.toString() ?? null : dto.maxPrice;
    this.validatePrices(minPrice, maxPrice);
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
      ...(dto.propertyType !== undefined ? { propertyType: dto.propertyType } : {}),
      ...(dto.transactionType !== undefined ? { transactionType: dto.transactionType } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency.toUpperCase() } : {}),
      ...(dto.minPrice !== undefined ? { minPrice: dto.minPrice } : {}),
      ...(dto.maxPrice !== undefined ? { maxPrice: dto.maxPrice } : {}),
      ...(dto.minRooms !== undefined ? { minRooms: dto.minRooms } : {}),
      ...(dto.alertsEnabled !== undefined ? { alertsEnabled: dto.alertsEnabled } : {}),
    };
  }

  private validatePrices(minPrice: string | null, maxPrice: string | null) {
    const min = minPrice === null ? null : Number(minPrice);
    const max = maxPrice === null ? null : Number(maxPrice);
    if ((min !== null && (!Number.isFinite(min) || min < 0)) ||
        (max !== null && (!Number.isFinite(max) || max < 0))) {
      throw new BadRequestException('저장 검색 가격 범위가 올바르지 않습니다.');
    }
    if (min !== null && max !== null && min > max) {
      throw new BadRequestException('최소 가격은 최대 가격보다 클 수 없습니다.');
    }
  }

  private view(row: {
    id: string; name: string; city: string | null; propertyType: string | null;
    transactionType: string | null; currency: string; minPrice: Prisma.Decimal | null;
    maxPrice: Prisma.Decimal | null; minRooms: number | null; alertsEnabled: boolean;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: row.id, name: row.name,
      criteria: {
        city: row.city, propertyType: row.propertyType,
        transactionType: row.transactionType, currency: row.currency,
        minPrice: row.minPrice?.toString() ?? null,
        maxPrice: row.maxPrice?.toString() ?? null, minRooms: row.minRooms,
      },
      alertsEnabled: row.alertsEnabled, createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
