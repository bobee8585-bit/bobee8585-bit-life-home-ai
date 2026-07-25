import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { LocalMediaStorageService } from './local-media-storage.service';
import { MediaProcessingService } from './media-processing.service';

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function service(): Promise<{
  processor: MediaProcessingService;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'lifehome-media-test-'));
  temporaryDirectories.push(root);
  process.env.MEDIA_STORAGE_ROOT = root;
  return {
    processor: new MediaProcessingService(
      {} as PrismaService,
      new LocalMediaStorageService(),
    ),
    root,
  };
}

describe('MediaProcessingService', () => {
  it('converts listing images to compressed webp and creates a thumbnail', async () => {
    const { processor, root } = await service();
    const input = join(root, 'input.png');
    await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: '#2f6b4f',
      },
    })
      .png()
      .toFile(input);

    const output = await processor.processImage(
      '019c75df-0255-7000-8000-000000000101',
      input,
    );

    expect(output.mimeType).toBe('image/webp');
    expect(output.width).toBe(1200);
    expect(output.height).toBe(800);
    await expect(
      sharp(join(root, output.thumbnailKey)).metadata(),
    ).resolves.toMatchObject({ format: 'jpeg', width: 640, height: 480 });
  });

  it('compresses a video to mp4 and creates a jpeg thumbnail', async () => {
    const { processor, root } = await service();
    const input = join(root, 'input.mp4');
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
      input,
    ]);

    const output = await processor.processVideo(
      '019c75df-0255-7000-8000-000000000102',
      input,
    );

    expect(output.mimeType).toBe('video/mp4');
    expect(output.durationSeconds).toBe(2);
    await expect(
      sharp(join(root, output.thumbnailKey)).metadata(),
    ).resolves.toMatchObject({ format: 'jpeg', width: 640, height: 360 });
  });
});
