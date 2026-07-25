import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import {
  MEDIA_JOB_NAME,
  MEDIA_QUEUE_NAME,
  mediaRedisConnection,
  type MediaProcessingJob,
} from './media-processing-queue.service';
import { MediaProcessingService } from './media-processing.service';

@Injectable()
export class MediaProcessingWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MediaProcessingWorker.name);
  private worker?: Worker<MediaProcessingJob>;

  constructor(private readonly media: MediaProcessingService) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<MediaProcessingJob>(
      MEDIA_QUEUE_NAME,
      (job) => this.process(job),
      {
        connection: mediaRedisConnection(true),
        concurrency: this.positiveInt('MEDIA_WORKER_CONCURRENCY', 2),
        prefix: process.env.MEDIA_QUEUE_PREFIX ?? 'lifehome',
      },
    );
    this.worker.on('error', (error) => {
      this.logger.error(`Media worker error: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<MediaProcessingJob>): Promise<void> {
    if (job.name !== MEDIA_JOB_NAME) {
      throw new Error(`Unsupported media job: ${job.name}`);
    }
    const maxAttempts =
      typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    try {
      await this.media.processQueuedUpload(
        job.data.uploadId,
        job.attemptsMade + 1,
        maxAttempts,
      );
    } catch (error: unknown) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        job.discard();
      }
      throw error;
    }
  }

  private positiveInt(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
