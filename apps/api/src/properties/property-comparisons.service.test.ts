import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CurrencyService } from '../currency/currency.service';
import type { PrismaService } from '../database/prisma.service';
import { PropertyStatus } from '../generated/prisma/client';
import { PropertyComparisonsService } from './property-comparisons.service';

describe('PropertyComparisonsService', () => {
  it('enforces the five-property limit', async () => { const prisma = { property: { findFirst: vi.fn(async () => ({ id: 'new' })) }, propertyComparisonItem: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => Array.from({ length: 5 }, (_, index) => ({ id: `${index}`, propertyId: `${index}`, sortOrder: index }))) } } as unknown as PrismaService; await expect(new PropertyComparisonsService(prisma, {} as CurrencyService).add('member', 'new')).rejects.toBeInstanceOf(ConflictException); });
  it('returns only the identifier for an inactive property', async () => { const prisma = { propertyComparisonItem: { findMany: vi.fn(async () => [{ sortOrder: 0, property: { id: 'inactive', status: PropertyStatus.INACTIVE, media: [] } }]) } } as unknown as PrismaService; const result = await new PropertyComparisonsService(prisma, {} as CurrencyService).get('member', 'KRW'); expect(result.items[0]).toEqual({ propertyId: 'inactive', sortOrder: 0, available: false }); });
});
