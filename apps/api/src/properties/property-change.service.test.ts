import { describe, expect, it, vi } from 'vitest';
import type { SensitiveDataService } from '../common/sensitive-data.service';
import type { CurrencyService } from '../currency/currency.service';
import type { PrismaService } from '../database/prisma.service';
import {
  PropertyChangeType,
  PropertyDealStatus,
  PropertyStatus,
} from '../generated/prisma/client';
import { PropertiesService } from './properties.service';
import type { PropertyWatchesService } from './property-watches.service';

const updatedAt = new Date('2026-07-29T00:00:00.000Z');

describe('active property changes', () => {
  it('updates price with optimistic concurrency and records a snapshot', async () => {
    const tx = {
      property: { updateMany: vi.fn(async () => ({ count: 1 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      property: {
        findFirst: vi.fn(async () => ({
          id: 'property',
          listingNumber: 'LH-PRICE',
          price: { toString: () => '900000000' },
          currency: 'KRW',
          updatedAt,
        })),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaService;
    const recordChange = vi.fn(async () => 'event');
    const service = new PropertiesService(
      prisma,
      {} as CurrencyService,
      {} as SensitiveDataService,
      { recordChange } as unknown as PropertyWatchesService,
    );
    await service.updatePrice('owner', 'property', {
      price: '880000000',
      expectedUpdatedAt: updatedAt.toISOString(),
    });
    expect(tx.property.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ updatedAt }),
        data: expect.objectContaining({ price: '880000000' }),
      }),
    );
    expect(recordChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: PropertyChangeType.PRICE,
        before: { price: '900000000', currency: 'KRW' },
        after: { price: '880000000', currency: 'KRW' },
      }),
    );
  });

  it('deactivates a completed listing and records its deal status change', async () => {
    const tx = {
      property: { updateMany: vi.fn(async () => ({ count: 1 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      property: {
        findFirst: vi.fn(async () => ({
          id: 'property',
          listingNumber: 'LH-DEAL',
          status: PropertyStatus.ACTIVE,
          dealStatus: PropertyDealStatus.CONTRACTING,
          updatedAt,
        })),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaService;
    const recordChange = vi.fn(async () => 'event');
    const service = new PropertiesService(
      prisma,
      {} as CurrencyService,
      {} as SensitiveDataService,
      { recordChange } as unknown as PropertyWatchesService,
    );
    const result = await service.updateDealStatus('owner', 'property', {
      dealStatus: PropertyDealStatus.COMPLETED,
      expectedUpdatedAt: updatedAt.toISOString(),
    });
    expect(tx.property.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dealStatus: PropertyDealStatus.COMPLETED,
          status: PropertyStatus.INACTIVE,
        }),
      }),
    );
    expect(recordChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: PropertyChangeType.DEAL_STATUS }),
    );
    expect(result.publicationStatus).toBe(PropertyStatus.INACTIVE);
  });
});
