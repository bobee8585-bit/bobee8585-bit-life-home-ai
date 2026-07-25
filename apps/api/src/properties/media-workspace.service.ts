import { Injectable } from '@nestjs/common';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export interface MediaWorkspace {
  directory: string;
  inputPath: string;
  outputPath: string;
  thumbnailPath: string;
  outputKey: string;
  thumbnailKey: string;
}

@Injectable()
export class MediaWorkspaceService {
  private readonly root = resolve(
    process.env.MEDIA_WORK_ROOT ?? '/tmp/lifehome-media-work',
  );

  async prepare(
    uploadId: string,
    extension: 'webp' | 'mp4',
  ): Promise<MediaWorkspace> {
    const directory = this.resolve(uploadId);
    await mkdir(directory, { recursive: true });
    return {
      directory,
      inputPath: this.resolve(`${uploadId}/source`),
      outputPath: this.resolve(`${uploadId}/media.${extension}`),
      thumbnailPath: this.resolve(`${uploadId}/thumbnail.jpg`),
      outputKey: `processed/${uploadId}/media.${extension}`,
      thumbnailKey: `processed/${uploadId}/thumbnail.jpg`,
    };
  }

  async size(path: string): Promise<bigint> {
    return BigInt((await stat(path)).size);
  }

  async cleanup(uploadId: string): Promise<void> {
    await rm(this.resolve(uploadId), { recursive: true, force: true });
  }

  private resolve(key: string): string {
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Invalid media workspace path.');
    }
    return path;
  }
}
