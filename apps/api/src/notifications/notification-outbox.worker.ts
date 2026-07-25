import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createId } from '../common/id';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { PrismaService } from '../database/prisma.service';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEndpointStatus,
  Prisma,
} from '../generated/prisma/client';
import {
  NotificationProviderService,
  NotificationSendError,
} from './notification-provider.service';
import { NotificationTemplateService } from './notification-template.service';

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_LOCK_SECONDS = 120;
const DEFAULT_POLL_MS = 5_000;

const notificationInclude = {
  recipient: {
    select: {
      phoneCountryCode: true,
      phoneNumberEncrypted: true,
      phoneVerifiedAt: true,
      notificationEndpoints: {
        where: {
          channel: NotificationChannel.PUSH,
          status: NotificationEndpointStatus.ACTIVE,
        },
        orderBy: { lastSeenAt: 'desc' as const },
      },
    },
  },
} as const;

type ClaimedNotification = Prisma.NotificationOutboxGetPayload<{
  include: typeof notificationInclude;
}>;

@Injectable()
export class NotificationOutboxWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationOutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sensitiveData: SensitiveDataService,
    private readonly templates: NotificationTemplateService,
    private readonly provider: NotificationProviderService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) {
      return;
    }
    const pollMs = this.positiveInt(
      'NOTIFICATION_WORKER_POLL_MS',
      DEFAULT_POLL_MS,
    );
    this.timer = setInterval(() => {
      void this.drainOnce();
    }, pollMs);
    this.timer.unref();
    void this.drainOnce();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async drainOnce(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      const claimed = await this.claim();
      await Promise.all(claimed.map((item) => this.deliver(item)));
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<ClaimedNotification[]> {
    const now = new Date();
    const expiredLock = new Date(
      now.getTime() -
        this.positiveInt(
          'NOTIFICATION_WORKER_LOCK_SECONDS',
          DEFAULT_LOCK_SECONDS,
        ) *
          1_000,
    );
    await this.prisma.notificationOutbox.updateMany({
      where: {
        status: NotificationDeliveryStatus.PROCESSING,
        lockedAt: { lt: expiredLock },
      },
      data: {
        status: NotificationDeliveryStatus.PENDING,
        lockedAt: null,
        lockId: null,
      },
    });

    const candidates = await this.prisma.notificationOutbox.findMany({
      where: {
        status: NotificationDeliveryStatus.PENDING,
        nextAttemptAt: { lte: now },
        lockId: null,
      },
      select: { id: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: this.positiveInt(
        'NOTIFICATION_WORKER_BATCH_SIZE',
        DEFAULT_BATCH_SIZE,
      ),
    });
    if (candidates.length === 0) {
      return [];
    }

    const lockId = createId();
    await this.prisma.notificationOutbox.updateMany({
      where: {
        id: { in: candidates.map(({ id }) => id) },
        status: NotificationDeliveryStatus.PENDING,
        lockId: null,
      },
      data: {
        status: NotificationDeliveryStatus.PROCESSING,
        lockedAt: now,
        lockId,
        attempts: { increment: 1 },
      },
    });
    return this.prisma.notificationOutbox.findMany({
      where: {
        lockId,
        status: NotificationDeliveryStatus.PROCESSING,
      },
      include: notificationInclude,
    });
  }

  private async deliver(item: ClaimedNotification): Promise<void> {
    const message = this.templates.render(
      item.type,
      item.aggregateType,
      item.aggregateId,
      item.payload,
    );
    try {
      const push = await this.tryPush(item, message);
      if (push) {
        await this.markSent(
          item.id,
          item.lockId,
          NotificationChannel.PUSH,
          push.provider,
          push.messageIds,
        );
        return;
      }

      if (!item.smsFallbackAllowed) {
        await this.markSkipped(item.id, item.lockId);
        return;
      }
      const phone = this.phone(item.recipient);
      if (!phone) {
        throw new NotificationSendError(
          '사용 가능한 푸시 토큰이나 인증 휴대폰 번호가 없습니다.',
          'NO_DELIVERY_TARGET',
          false,
        );
      }
      const sms = await this.provider.sendSms(phone, message);
      await this.markSent(
        item.id,
        item.lockId,
        NotificationChannel.SMS,
        sms.provider,
        [sms.messageId],
      );
    } catch (error: unknown) {
      await this.markFailed(item, error);
    }
  }

  private async tryPush(
    item: ClaimedNotification,
    message: ReturnType<NotificationTemplateService['render']>,
  ): Promise<{ provider: string; messageIds: string[] } | null> {
    const successes: Array<{ provider: string; messageId: string }> = [];
    const transientErrors: NotificationSendError[] = [];

    for (const endpoint of item.recipient.notificationEndpoints) {
      try {
        const token = this.sensitiveData.decrypt(
          endpoint.destinationEncrypted,
        );
        successes.push(await this.provider.sendPush(token, message));
      } catch (error: unknown) {
        if (
          error instanceof NotificationSendError &&
          this.invalidToken(error.code)
        ) {
          await this.prisma.notificationEndpoint.updateMany({
            where: {
              id: endpoint.id,
              status: NotificationEndpointStatus.ACTIVE,
            },
            data: {
              status: NotificationEndpointStatus.INVALID,
              invalidatedAt: new Date(),
            },
          });
          continue;
        }
        if (error instanceof NotificationSendError && error.retryable) {
          transientErrors.push(error);
          continue;
        }
        throw error;
      }
    }

    if (successes.length > 0) {
      return {
        provider: successes[0]?.provider ?? 'FCM',
        messageIds: successes.map(({ messageId }) => messageId),
      };
    }
    if (transientErrors.length > 0) {
      throw transientErrors[0];
    }
    return null;
  }

  private phone(recipient: {
    phoneCountryCode: string | null;
    phoneNumberEncrypted: string | null;
    phoneVerifiedAt: Date | null;
  }): string | null {
    if (
      !recipient.phoneVerifiedAt ||
      !recipient.phoneNumberEncrypted ||
      !recipient.phoneCountryCode
    ) {
      return null;
    }
    const number = this.sensitiveData.decrypt(
      recipient.phoneNumberEncrypted,
    );
    const country = recipient.phoneCountryCode.toUpperCase();
    if (country === 'KR') {
      return number;
    }
    if (number.replace(/\D/g, '').startsWith('82')) {
      return number;
    }
    return null;
  }

  private async markSent(
    id: string,
    lockId: string | null,
    channel: NotificationChannel,
    provider: string,
    messageIds: string[],
  ): Promise<void> {
    await this.prisma.notificationOutbox.updateMany({
      where: {
        id,
        lockId,
        status: NotificationDeliveryStatus.PROCESSING,
      },
      data: {
        status: NotificationDeliveryStatus.SENT,
        deliveryChannel: channel,
        deliveryProvider: provider,
        providerMessageIds: messageIds,
        sentAt: new Date(),
        lastError: null,
        lockedAt: null,
        lockId: null,
      },
    });
  }

  private async markSkipped(
    id: string,
    lockId: string | null,
  ): Promise<void> {
    await this.prisma.notificationOutbox.updateMany({
      where: {
        id,
        lockId,
        status: NotificationDeliveryStatus.PROCESSING,
      },
      data: {
        status: NotificationDeliveryStatus.SKIPPED,
        deliveryChannel: null,
        deliveryProvider: 'PUSH_ONLY_NO_TARGET',
        providerMessageIds: [],
        lastError: null,
        lockedAt: null,
        lockId: null,
      },
    });
  }

  private async markFailed(
    item: ClaimedNotification,
    error: unknown,
  ): Promise<void> {
    const maxAttempts = this.positiveInt(
      'NOTIFICATION_WORKER_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
    );
    const sendError =
      error instanceof NotificationSendError
        ? error
        : new NotificationSendError(
            '예상하지 못한 전송 오류가 발생했습니다.',
            'DELIVERY_UNEXPECTED',
            true,
          );
    const retry = sendError.retryable && item.attempts < maxAttempts;
    const nextAttemptAt = retry
      ? new Date(Date.now() + this.backoffMs(item.attempts))
      : item.nextAttemptAt;
    await this.prisma.notificationOutbox.updateMany({
      where: {
        id: item.id,
        lockId: item.lockId,
        status: NotificationDeliveryStatus.PROCESSING,
      },
      data: {
        status: retry
          ? NotificationDeliveryStatus.PENDING
          : NotificationDeliveryStatus.FAILED,
        nextAttemptAt,
        lastError: sendError.code.slice(0, 240),
        lockedAt: null,
        lockId: null,
      },
    });
    if (!retry) {
      this.logger.warn(
        `notification delivery failed id=${item.id} code=${sendError.code}`,
      );
    }
  }

  private backoffMs(attempts: number): number {
    const base = this.positiveInt(
      'NOTIFICATION_WORKER_RETRY_BASE_SECONDS',
      30,
    );
    return Math.min(base * 2 ** Math.max(0, attempts - 1), 3_600) * 1_000;
  }

  private invalidToken(code: string): boolean {
    return code === 'FCM_UNREGISTERED';
  }

  private enabled(): boolean {
    if (process.env.NODE_ENV === 'test') {
      return false;
    }
    return (
      process.env.NOTIFICATION_WORKER_ENABLED?.trim().toLowerCase() !==
      'false'
    );
  }

  private positiveInt(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
