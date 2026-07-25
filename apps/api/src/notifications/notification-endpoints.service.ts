import { Injectable } from '@nestjs/common';
import { createId } from '../common/id';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { PrismaService } from '../database/prisma.service';
import {
  NotificationChannel,
  NotificationEndpointStatus,
} from '../generated/prisma/client';
import type { RegisterPushEndpointDto } from './dto/register-push-endpoint.dto';

@Injectable()
export class NotificationEndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sensitiveData: SensitiveDataService,
  ) {}

  async registerPush(userId: string, dto: RegisterPushEndpointDto) {
    const token = dto.token.trim();
    const destinationHash = this.sensitiveData.hash(token);
    const deviceIdHash = this.sensitiveData.hash(dto.deviceId);
    const now = new Date();
    const endpoint = await this.prisma.$transaction(async (transaction) => {
      const tokenOwner = await transaction.notificationEndpoint.findUnique({
        where: { destinationHash },
        select: { id: true, userId: true, deviceIdHash: true },
      });
      if (
        tokenOwner &&
        (tokenOwner.userId !== userId ||
          tokenOwner.deviceIdHash !== deviceIdHash)
      ) {
        await transaction.notificationEndpoint.update({
          where: { id: tokenOwner.id },
          data: {
            status: NotificationEndpointStatus.REVOKED,
            destinationEncrypted: '',
            destinationHash: this.sensitiveData.hash(
              `revoked:${tokenOwner.id}:${now.toISOString()}`,
            ),
            deviceIdHash: null,
            invalidatedAt: now,
          },
        });
      }

      return transaction.notificationEndpoint.upsert({
        where: {
          userId_channel_deviceIdHash: {
            userId,
            channel: NotificationChannel.PUSH,
            deviceIdHash,
          },
        },
        update: {
          platform: dto.platform,
          provider: 'FCM',
          destinationEncrypted: this.sensitiveData.encrypt(token),
          destinationHash,
          locale: dto.locale ?? 'ko-KR',
          status: NotificationEndpointStatus.ACTIVE,
          lastSeenAt: now,
          invalidatedAt: null,
        },
        create: {
          id: createId(),
          userId,
          channel: NotificationChannel.PUSH,
          platform: dto.platform,
          provider: 'FCM',
          destinationEncrypted: this.sensitiveData.encrypt(token),
          destinationHash,
          deviceIdHash,
          locale: dto.locale ?? 'ko-KR',
          lastSeenAt: now,
        },
      });
    });
    return this.view(endpoint);
  }

  async list(userId: string) {
    const endpoints = await this.prisma.notificationEndpoint.findMany({
      where: {
        userId,
        channel: NotificationChannel.PUSH,
        status: { not: NotificationEndpointStatus.REVOKED },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return endpoints.map((endpoint) => this.view(endpoint));
  }

  async unregister(userId: string, deviceId: string) {
    const deviceIdHash = this.sensitiveData.hash(deviceId);
    await this.prisma.notificationEndpoint.updateMany({
      where: {
        userId,
        channel: NotificationChannel.PUSH,
        deviceIdHash,
      },
      data: {
        status: NotificationEndpointStatus.REVOKED,
        destinationEncrypted: '',
        destinationHash: this.sensitiveData.hash(
          `revoked:${userId}:${deviceId}:${createId()}`,
        ),
        deviceIdHash: null,
        invalidatedAt: new Date(),
      },
    });
    return { unregistered: true as const };
  }

  private view(endpoint: {
    id: string;
    channel: NotificationChannel;
    platform: string | null;
    provider: string;
    status: NotificationEndpointStatus;
    locale: string | null;
    lastSeenAt: Date;
  }) {
    return {
      id: endpoint.id,
      channel: endpoint.channel,
      platform: endpoint.platform,
      provider: endpoint.provider,
      status: endpoint.status,
      locale: endpoint.locale,
      lastSeenAt: endpoint.lastSeenAt.toISOString(),
    };
  }
}
