import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  PropertyChangeType,
  PropertyDealStatus,
  PropertyStatus,
} from '../generated/prisma/client';
import { PropertyWatchesService } from './property-watches.service';

const watchedProperty = {
  id: '019d1f00-0000-7000-8000-000000000101',
  listingNumber: 'LH-2026-WATCH',
  brokerUserId: 'owner',
  title: '관심 매물',
  price: { toString: () => '900000000' },
  currency: 'KRW',
  status: PropertyStatus.INACTIVE,
  dealStatus: PropertyDealStatus.COMPLETED,
  media: [],
};

describe('PropertyWatchesService', () => {
  it('retains publication and deal status after a listing becomes inactive', async () => {
    const prisma = {
      propertyWatch: {
        findMany: vi.fn(async () => [{
          id: 'watch',
          alertOnPriceChange: true,
          alertOnPhotoChange: true,
          alertOnDealStatusChange: true,
          createdAt: new Date('2026-07-29T00:00:00Z'),
          updatedAt: new Date('2026-07-29T01:00:00Z'),
          property: watchedProperty,
        }]),
      },
    } as unknown as PrismaService;
    const result = await new PropertyWatchesService(prisma).list('member');
    expect(result[0]?.property).toMatchObject({
      publicationStatus: PropertyStatus.INACTIVE,
      dealStatus: PropertyDealStatus.COMPLETED,
    });
  });

  it('blocks watching the member own listing', async () => {
    const tx = {
      $queryRaw: vi.fn(async () => []),
      property: {
        findFirst: vi.fn(async () => ({ ...watchedProperty, brokerUserId: 'member' })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaService;
    await expect(
      new PropertyWatchesService(prisma).create(
        'member',
        watchedProperty.id,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces the 200 watch limit while holding the user lock', async () => {
    const tx = {
      $queryRaw: vi.fn(async () => []),
      property: {
        findFirst: vi.fn(async () => ({ ...watchedProperty, brokerUserId: 'owner' })),
      },
      propertyWatch: {
        findUnique: vi.fn(async () => null),
        count: vi.fn(async () => 200),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaService;
    await expect(
      new PropertyWatchesService(prisma).create(
        'member',
        watchedProperty.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
  });

  it('requires at least one alert setting to update', async () => {
    await expect(
      new PropertyWatchesService({} as PrismaService).update(
        'member',
        'watch',
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not expose change history to a non-owner', async () => {
    const prisma = {
      propertyWatch: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;
    await expect(
      new PropertyWatchesService(prisma).changes('member', 'watch'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('queues duplicate-safe push-only alerts without change snapshots', async () => {
    const outbox = vi.fn(async () => ({ count: 1 }));
    const tx = {
      propertyChangeEvent: { create: vi.fn(async () => ({})) },
      propertyWatch: {
        findMany: vi.fn(async () => [{ id: 'watch', userId: 'member' }]),
      },
      propertyWatchAlert: { createMany: vi.fn(async () => ({ count: 1 })) },
      notificationOutbox: { createMany: outbox },
    };
    await new PropertyWatchesService({} as PrismaService).recordChange(
      tx as never,
      {
        propertyId: watchedProperty.id,
        listingNumber: watchedProperty.listingNumber,
        actorUserId: 'owner',
        type: PropertyChangeType.PRICE,
        before: { price: '900000000' },
        after: { price: '880000000' },
      },
    );
    const notification = outbox.mock.calls[0]?.[0].data[0];
    expect(notification.smsFallbackAllowed).toBe(false);
    expect(Object.keys(notification.payload).sort()).toEqual([
      'changeEventId',
      'changeType',
      'listingNumber',
      'propertyId',
    ]);
    expect(JSON.stringify(notification.payload)).not.toContain('880000000');
  });
});
