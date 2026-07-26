import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { Prisma, PropertyType } from '../generated/prisma/client';
import { SavedPropertySearchesService } from './saved-property-searches.service';

describe('SavedPropertySearchesService', () => {
  it('limits each member to twenty saved searches', async () => {
    const prisma = {
      savedPropertySearch: {
        count: vi.fn(async () => 20), findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
    } as unknown as PrismaService;
    await expect(new SavedPropertySearchesService(prisma).create('user', {
      name: '서울 아파트', currency: 'KRW', alertsEnabled: true,
    })).rejects.toThrow(ConflictException);
  });

  it('rejects an inverted price range before updating', async () => {
    const prisma = {
      savedPropertySearch: { findFirst: vi.fn(async () => ({
        id: 'search', userId: 'user', name: '서울', minPrice: new Prisma.Decimal('100'),
        maxPrice: new Prisma.Decimal('200'), alertsEnabled: true,
      })) },
    } as unknown as PrismaService;
    await expect(new SavedPropertySearchesService(prisma).update(
      'user', '019c75df-0255-7000-8000-000000000902',
      { minPrice: '300', maxPrice: '200' },
    )).rejects.toThrow(BadRequestException);
  });

  it('stores normalized criteria and a minimal audit record', async () => {
    const now = new Date();
    const auditCreate = vi.fn(async () => ({}));
    const tx = {
      savedPropertySearch: { create: vi.fn(async ({ data }: any) => ({
        ...data, city: '서울', propertyType: PropertyType.APARTMENT,
        transactionType: null, minPrice: new Prisma.Decimal('500000000'),
        maxPrice: null, minRooms: null, createdAt: now, updatedAt: now,
      })) },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      savedPropertySearch: {
        count: vi.fn(async () => 0), findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (input: unknown) =>
        typeof input === 'function'
          ? (input as (client: typeof tx) => unknown)(tx)
          : Promise.all(input as Promise<unknown>[])),
    } as unknown as PrismaService;
    const result = await new SavedPropertySearchesService(prisma).create('user', {
      name: '  서울 아파트  ', city: ' 서울 ', propertyType: PropertyType.APARTMENT,
      currency: 'KRW', minPrice: '500000000', alertsEnabled: true,
    });
    expect(result.name).toBe('서울 아파트');
    expect(result.criteria.city).toBe('서울');
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('500000000');
  });
});
