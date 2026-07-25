import { describe, expect, it, vi } from 'vitest';
import type { SensitiveDataService } from '../common/sensitive-data.service';
import type { PrismaService } from '../database/prisma.service';
import {
  NotificationDeliveryStatus,
  NotificationEndpointStatus,
} from '../generated/prisma/client';
import { NotificationOutboxWorker } from './notification-outbox.worker';
import type { NotificationProviderService } from './notification-provider.service';
import { NotificationSendError } from './notification-provider.service';
import { NotificationTemplateService } from './notification-template.service';

const outbox = (push = true) => ({
  id: '019c75df-0255-7000-8000-000000000701',
  recipientUserId: '019c75df-0255-7000-8000-000000000702',
  type: 'VISIT_RESERVATION_APPROVED',
  aggregateType: 'VisitReservation',
  aggregateId: '019c75df-0255-7000-8000-000000000703',
  smsFallbackAllowed: true,
  payload: {
    reservationNumber: 'VR-2026-TEST',
    startAt: '2026-07-26T01:00:00.000Z',
  },
  status: NotificationDeliveryStatus.PROCESSING,
  attempts: 1,
  nextAttemptAt: new Date(),
  deliveryChannel: null,
  deliveryProvider: null,
  providerMessageIds: null,
  lockedAt: new Date(),
  lockId: '019c75df-0255-7000-8000-000000000704',
  sentAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  recipient: {
    phoneCountryCode: 'KR',
    phoneNumberEncrypted: 'encrypted-phone',
    phoneVerifiedAt: new Date(),
    notificationEndpoints: push
      ? [
          {
            id: '019c75df-0255-7000-8000-000000000705',
            userId: '019c75df-0255-7000-8000-000000000702',
            channel: 'PUSH',
            platform: 'ANDROID',
            provider: 'FCM',
            destinationEncrypted: 'encrypted-token',
            destinationHash: 'hash',
            deviceIdHash: 'device',
            locale: 'ko-KR',
            status: NotificationEndpointStatus.ACTIVE,
            lastSeenAt: new Date(),
            invalidatedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]
      : [],
  },
});

function workerFixture(item: ReturnType<typeof outbox>) {
  const updates: unknown[] = [];
  const findMany = vi
    .fn()
    .mockResolvedValueOnce([{ id: item.id }])
    .mockResolvedValueOnce([item]);
  const prisma = {
    notificationOutbox: {
      updateMany: vi.fn(async (input: unknown) => {
        updates.push(input);
        return { count: 1 };
      }),
      findMany,
    },
    notificationEndpoint: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  } as unknown as PrismaService;
  const sensitive = {
    decrypt: vi.fn((value: string) =>
      value === 'encrypted-token' ? 'fcm-token' : '01012345678',
    ),
  } as unknown as SensitiveDataService;
  const provider = {
    sendPush: vi.fn(async () => ({
      provider: 'FCM',
      messageId: 'fcm-message-1',
    })),
    sendSms: vi.fn(async () => ({
      provider: 'NAVER_SENS',
      messageId: 'sms-message-1',
    })),
  } as unknown as NotificationProviderService;
  return {
    worker: new NotificationOutboxWorker(
      prisma,
      sensitive,
      new NotificationTemplateService(),
      provider,
    ),
    provider,
    updates,
  };
}

describe('NotificationOutboxWorker', () => {
  it('claims an event and records successful push delivery', async () => {
    const fixture = workerFixture(outbox(true));

    expect(await fixture.worker.drainOnce()).toBe(1);
    expect(fixture.provider.sendPush).toHaveBeenCalledOnce();
    expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    expect(fixture.updates.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.SENT,
          deliveryChannel: 'PUSH',
          deliveryProvider: 'FCM',
          providerMessageIds: ['fcm-message-1'],
        }),
      }),
    );
  });

  it('falls back to SMS when no active push endpoint exists', async () => {
    const fixture = workerFixture(outbox(false));

    await fixture.worker.drainOnce();

    expect(fixture.provider.sendPush).not.toHaveBeenCalled();
    expect(fixture.provider.sendSms).toHaveBeenCalledWith(
      '01012345678',
      expect.objectContaining({
        title: '방문 예약이 확정됐어요',
      }),
    );
    expect(fixture.updates.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.SENT,
          deliveryChannel: 'SMS',
          deliveryProvider: 'NAVER_SENS',
        }),
      }),
    );
  });

  it('does not spend SMS fallback on a push-only chat event', async () => {
    const item = {
      ...outbox(false),
      type: 'CHAT_MESSAGE_RECEIVED',
      aggregateType: 'PropertyChatRoom',
      smsFallbackAllowed: false,
      payload: { listingNumber: 'LH-2026-CHAT' },
    };
    const fixture = workerFixture(item);

    await fixture.worker.drainOnce();

    expect(fixture.provider.sendPush).not.toHaveBeenCalled();
    expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    expect(fixture.updates.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.SKIPPED,
          deliveryProvider: 'PUSH_ONLY_NO_TARGET',
          lastError: null,
        }),
      }),
    );
  });

  it('returns transient push failures to pending with a future retry', async () => {
    const fixture = workerFixture(outbox(true));
    vi.mocked(fixture.provider.sendPush).mockRejectedValueOnce(
      new NotificationSendError(
        'temporary provider outage',
        'FCM_TIMEOUT',
        true,
      ),
    );

    await fixture.worker.drainOnce();

    expect(fixture.provider.sendSms).not.toHaveBeenCalled();
    expect(fixture.updates.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationDeliveryStatus.PENDING,
          lastError: 'FCM_TIMEOUT',
          lockedAt: null,
          lockId: null,
        }),
      }),
    );
  });
});
