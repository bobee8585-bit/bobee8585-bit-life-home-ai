import { describe, expect, it, vi } from 'vitest';
import type { SensitiveDataService } from '../common/sensitive-data.service';
import type { PrismaService } from '../database/prisma.service';
import {
  NotificationChannel,
  NotificationEndpointStatus,
  Platform,
} from '../generated/prisma/client';
import { NotificationEndpointsService } from './notification-endpoints.service';

describe('NotificationEndpointsService', () => {
  it('encrypts push tokens and never returns them to the client', async () => {
    const created = {
      id: '019c75df-0255-7000-8000-000000000601',
      userId: 'user',
      channel: NotificationChannel.PUSH,
      platform: Platform.ANDROID,
      provider: 'FCM',
      destinationEncrypted: 'encrypted-token',
      destinationHash: 'token-hash',
      deviceIdHash: 'device-hash',
      locale: 'ko-KR',
      status: NotificationEndpointStatus.ACTIVE,
      lastSeenAt: new Date('2026-07-25T10:00:00.000Z'),
      invalidatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const transaction = {
      notificationEndpoint: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(),
        upsert: vi.fn(async () => created),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const sensitive = {
      hash: vi.fn((value: string) =>
        value.includes('device') ? 'device-hash' : 'token-hash',
      ),
      encrypt: vi.fn(() => 'encrypted-token'),
    } as unknown as SensitiveDataService;

    const result = await new NotificationEndpointsService(
      prisma,
      sensitive,
    ).registerPush('user', {
      deviceId: '019c75df-0255-7000-8000-000000000602',
      platform: Platform.ANDROID,
      token: 'fcm-registration-token-value',
      locale: 'ko-KR',
    });

    expect(transaction.notificationEndpoint.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          destinationEncrypted: 'encrypted-token',
          destinationHash: 'token-hash',
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('token');
    expect(result.status).toBe(NotificationEndpointStatus.ACTIVE);
  });
});
