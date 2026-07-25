import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';

export const MEDIA_QUEUE_NAME = 'property-media-processing';
export const MEDIA_JOB_NAME = 'process-property-media';

export interface MediaProcessingJob {
  uploadId: string;
}

export function mediaRedisConnection(
  worker: boolean,
): ConnectionOptions {
  const parsed = new URL(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
  );
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://.');
  }
  const database = parsed.pathname.replace('/', '');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: database ? Number(database) : 0,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    connectTimeout: 5_000,
    enableOfflineQueue: worker,
    maxRetriesPerRequest: worker ? null : 1,
  };
}

@Injectable()
export class MediaProcessingQueueService implements OnModuleDestroy {
  private queue?: Queue<MediaProcessingJob>;

  async enqueue(uploadId: string): Promise<void> {
    await this.getQueue().add(
      MEDIA_JOB_NAME,
      { uploadId },
      {
        jobId: uploadId,
        attempts: this.positiveInt('MEDIA_WORKER_MAX_ATTEMPTS', 4),
        backoff: {
          type: 'exponential',
          delay: this.positiveInt(
            'MEDIA_WORKER_RETRY_BASE_MS',
            5_000,
          ),
        },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<MediaProcessingJob> {
    this.queue ??= new Queue<MediaProcessingJob>(MEDIA_QUEUE_NAME, {
      connection: mediaRedisConnection(false),
      prefix: process.env.MEDIA_QUEUE_PREFIX ?? 'lifehome',
    });
    return this.queue;
  }

  private positiveInt(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
