import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { Prisma, PropertyTransactionType, PropertyType } from '../generated/prisma/client';
import type { CurrencyService } from '../currency/currency.service';
import type { SensitiveDataService } from '../common/sensitive-data.service';
import { PropertiesService } from './properties.service';

describe('saved property alerts', () => {
  it('queues a duplicate-safe push-only notification for a matching search', async () => {
    const alerts = vi.fn(async () => ({ count: 1 }));
    const outbox = vi.fn(async () => ({ count: 1 }));
    const tx = {
      savedPropertySearch: { findMany: vi.fn(async () => [{ id: 'search', userId: 'member' }]) },
      savedPropertyAlert: { findMany: vi.fn(async () => []), createMany: alerts },
      notificationOutbox: { createMany: outbox },
    };
    const service = new PropertiesService(
      {} as PrismaService, {} as CurrencyService, {} as SensitiveDataService,
    );
    await (service as any).enqueueNewListingAlerts(tx, {
      id: '019c75df-0255-7000-8000-000000000920',
      listingNumber: 'LH-2026-0920', brokerUserId: 'broker', city: '서울',
      propertyType: PropertyType.APARTMENT,
      transactionType: PropertyTransactionType.SALE,
      currency: 'KRW', price: new Prisma.Decimal('800000000'), rooms: 3,
    });
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(outbox).toHaveBeenCalledWith({ data: [expect.objectContaining({
      recipientUserId: 'member', type: 'PROPERTY_NEW_LISTING_MATCH',
      smsFallbackAllowed: false,
    })] });
  });
});
