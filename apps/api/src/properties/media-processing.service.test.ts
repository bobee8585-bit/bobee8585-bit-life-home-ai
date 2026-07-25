import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { MediaUploadStatus } from '../generated/prisma/client';
import { MediaObjectStorageService } from './media-object-storage.service';
import type { MediaProcessingQueueService } from './media-processing-queue.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaWorkspaceService } from './media-workspace.service';

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function service(prisma = {} as PrismaService): Promise<{
  processor: MediaProcessingService;
  workspace: MediaWorkspaceService;
  root: string;
  queued: string[];
}> {
  const root = await mkdtemp(join(tmpdir(), 'lifehome-media-test-'));
  temporaryDirectories.push(root);
  process.env.MEDIA_STORAGE_MODE = 'local';
  process.env.MEDIA_STORAGE_ROOT = join(root, 'objects');
  process.env.MEDIA_WORK_ROOT = join(root, 'work');
  const queued: string[] = [];
  const queue = {
    enqueue: async (uploadId: string) => {
      queued.push(uploadId);
    },
  } as MediaProcessingQueueService;
  const workspace = new MediaWorkspaceService();
  return {
    processor: new MediaProcessingService(
      prisma,
      new MediaObjectStorageService(),
      workspace,
      queue,
    ),
    workspace,
    root,
    queued,
  };
}

describe('MediaProcessingService', () => {
  it('converts listing images to compressed webp and creates a thumbnail', async () => {
    const { processor, workspace } = await service();
    const work = await workspace.prepare(
      '019c75df-0255-7000-8000-000000000101',
      'webp',
    );
    await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: '#2f6b4f',
      },
    })
      .png()
      .toFile(work.inputPath);

    const output = await processor.processImage(work);

    expect(output.mimeType).toBe('image/webp');
    expect(output.width).toBe(1200);
    expect(output.height).toBe(800);
    await expect(sharp(output.thumbnailPath).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 480,
    });
  });

  it('compresses a video to mp4 and creates a jpeg thumbnail', async () => {
    const { processor, workspace } = await service();
    const work = await workspace.prepare(
      '019c75df-0255-7000-8000-000000000102',
      'mp4',
    );
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=640x360:d=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'mp4',
      work.inputPath,
    ]);

    const output = await processor.processVideo(work);

    expect(output.mimeType).toBe('video/mp4');
    expect(output.durationSeconds).toBe(2);
    await expect(sharp(output.thumbnailPath).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 360,
    });
  });

  it('stores an upload request and queues processing without transforming inline', async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      property: {
        findFirst: async () => ({
          id: '019c75df-0255-7000-8000-000000000201',
        }),
      },
      propertyMedia: { findMany: async () => [] },
      propertyMediaUpload: {
        findMany: async () => [],
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
      },
      $queryRaw: async () => [],
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) => callback(prisma),
    } as unknown as PrismaService;
    const { processor, root, queued } = await service(prisma);
    const input = join(root, 'incoming.png');
    await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toFile(input);

    const response = await processor.requestUpload(
      '019c75df-0255-7000-8000-000000000202',
      '019c75df-0255-7000-8000-000000000201',
      {
        path: input,
        mimetype: 'image/png',
        size: 512,
        originalname: 'home.png',
      } as Express.Multer.File,
      { isPublic: true, sortOrder: 0 },
    );

    expect(response.status).toBe(MediaUploadStatus.REQUESTED);
    expect(created[0]?.status).toBe(MediaUploadStatus.REQUESTED);
    expect(queued).toEqual([response.uploadId]);
  });

  it('counts in-flight uploads when enforcing the public video limit', async () => {
    const prisma = {
      property: {
        findFirst: async () => ({
          id: '019c75df-0255-7000-8000-000000000301',
        }),
      },
      propertyMedia: { findMany: async () => [] },
      propertyMediaUpload: {
        findMany: async () => [{ requestedIsPublic: true }],
      },
    } as unknown as PrismaService;
    const { processor, root, queued } = await service(prisma);
    const input = join(root, 'incoming.mp4');
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      input,
    ]);

    await expect(
      processor.requestUpload(
        '019c75df-0255-7000-8000-000000000302',
        '019c75df-0255-7000-8000-000000000301',
        {
          path: input,
          mimetype: 'video/mp4',
          size: 1024,
          originalname: 'home.mp4',
        } as Express.Multer.File,
        { isPublic: true, sortOrder: 0 },
      ),
    ).rejects.toThrow('공개 동영상');
    expect(queued).toHaveLength(0);
  });
});
