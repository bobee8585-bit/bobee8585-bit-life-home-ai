import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

@Injectable()
export class LocalMediaStorageService {
  private readonly root = resolve(
    process.env.MEDIA_STORAGE_ROOT ?? '/tmp/lifehome-media',
  );

  async prepare(uploadId: string, extension: 'webp' | 'mp4'): Promise<{
    outputPath: string;
    outputKey: string;
    thumbnailPath: string;
    thumbnailKey: string;
  }> {
    const directory = resolve(this.root, uploadId);
    await mkdir(directory, { recursive: true });
    const outputKey = `${uploadId}/media.${extension}`;
    const thumbnailKey = `${uploadId}/thumbnail.jpg`;
    return {
      outputPath: this.resolveKey(outputKey),
      outputKey,
      thumbnailPath: this.resolveKey(thumbnailKey),
      thumbnailKey,
    };
  }

  resolveKey(key: string): string {
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new NotFoundException('미디어 파일을 찾을 수 없습니다.');
    }
    return path;
  }

  async size(path: string): Promise<bigint> {
    return BigInt((await stat(path)).size);
  }

  async removeUpload(uploadId: string): Promise<void> {
    await rm(resolve(this.root, uploadId), {
      recursive: true,
      force: true,
    });
  }
}
