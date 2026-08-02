import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { PropertyBrowsingService } from './property-browsing.service';

describe('PropertyBrowsingService', () => {
  it('rejects a view for a non-public property', async () => { const prisma = { property: { findFirst: vi.fn(async () => null) } } as unknown as PrismaService; await expect(new PropertyBrowsingService(prisma).recordView('member', 'property')).rejects.toBeInstanceOf(NotFoundException); });
  it('clears one or all recent views', async () => { const remove = vi.fn(async () => ({ count: 2 })); const result = await new PropertyBrowsingService({ recentPropertyView: { deleteMany: remove } } as unknown as PrismaService).clearViews('member'); expect(result.deleted).toBe(2); });
  it('clears one or all recent searches', async () => { const remove = vi.fn(async () => ({ count: 1 })); const result = await new PropertyBrowsingService({ recentPropertySearch: { deleteMany: remove } } as unknown as PrismaService).clearSearches('member', 'search'); expect(result.deleted).toBe(1); });
});
