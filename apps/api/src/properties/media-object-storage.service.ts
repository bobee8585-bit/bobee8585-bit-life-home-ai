import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve, sep } from 'node:path';

export interface StoredMediaObject {
  stream: Readable;
  contentLength?: number;
  contentType?: string;
}

type StorageMode = 'local' | 's3';

@Injectable()
export class MediaObjectStorageService implements OnModuleDestroy {
  private readonly mode: StorageMode;
  private readonly localRoot: string;
  private readonly bucket?: string;
  private readonly client?: S3Client;

  constructor() {
    this.mode = this.storageMode();
    this.localRoot = resolve(
      process.env.MEDIA_STORAGE_ROOT ?? '/tmp/lifehome-media',
    );
    if (this.mode === 's3') {
      this.bucket = this.required('MEDIA_S3_BUCKET');
      this.client = new S3Client(this.s3Configuration());
    }
  }

  async putFile(
    key: string,
    sourcePath: string,
    contentType: string,
  ): Promise<void> {
    this.assertKey(key);
    if (this.mode === 'local') {
      const destination = this.localPath(key);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(sourcePath, destination);
      return;
    }
    await this.client!.send(
      new PutObjectCommand({
        Bucket: this.bucket!,
        Key: key,
        Body: createReadStream(sourcePath),
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async getFile(key: string, destinationPath: string): Promise<void> {
    this.assertKey(key);
    await mkdir(dirname(destinationPath), { recursive: true });
    if (this.mode === 'local') {
      await copyFile(this.localPath(key), destinationPath);
      return;
    }
    const object = await this.client!.send(
      new GetObjectCommand({ Bucket: this.bucket!, Key: key }),
    );
    await pipeline(
      this.readable(object.Body),
      createWriteStream(destinationPath),
    );
  }

  async open(key: string): Promise<StoredMediaObject> {
    this.assertKey(key);
    if (this.mode === 'local') {
      return { stream: createReadStream(this.localPath(key)) };
    }
    const object = await this.client!.send(
      new GetObjectCommand({ Bucket: this.bucket!, Key: key }),
    );
    return {
      stream: this.readable(object.Body),
      contentLength: object.ContentLength,
      contentType: object.ContentType,
    };
  }

  async remove(key: string | null | undefined): Promise<void> {
    if (!key) {
      return;
    }
    this.assertKey(key);
    if (this.mode === 'local') {
      await rm(this.localPath(key), { force: true });
      return;
    }
    await this.client!.send(
      new DeleteObjectCommand({ Bucket: this.bucket!, Key: key }),
    );
  }

  async removeMany(keys: Array<string | null | undefined>): Promise<void> {
    await Promise.all(keys.map((key) => this.remove(key)));
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  storageProvider(): 'LOCAL' | 'S3' {
    return this.mode === 's3' ? 'S3' : 'LOCAL';
  }

  private storageMode(): StorageMode {
    const configured = (process.env.MEDIA_STORAGE_MODE ?? 'local').toLowerCase();
    if (configured !== 'local' && configured !== 's3') {
      throw new Error('MEDIA_STORAGE_MODE must be local or s3.');
    }
    if (process.env.NODE_ENV === 'production' && configured !== 's3') {
      throw new Error('Production media storage must use s3 mode.');
    }
    return configured;
  }

  private s3Configuration(): S3ClientConfig {
    const accessKeyId = process.env.MEDIA_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.MEDIA_S3_SECRET_ACCESS_KEY;
    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      throw new Error(
        'MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY must be configured together.',
      );
    }
    return {
      region: process.env.MEDIA_S3_REGION ?? 'ap-northeast-2',
      endpoint: process.env.MEDIA_S3_ENDPOINT || undefined,
      forcePathStyle: this.boolean('MEDIA_S3_FORCE_PATH_STYLE', false),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    };
  }

  private localPath(key: string): string {
    const path = resolve(this.localRoot, key);
    if (path !== this.localRoot && !path.startsWith(`${this.localRoot}${sep}`)) {
      throw new NotFoundException('미디어 파일을 찾을 수 없습니다.');
    }
    return path;
  }

  private assertKey(key: string): void {
    if (
      !key ||
      key.startsWith('/') ||
      key.includes('..') ||
      !/^[a-zA-Z0-9/_\-.]+$/.test(key)
    ) {
      throw new NotFoundException('미디어 파일을 찾을 수 없습니다.');
    }
  }

  private readable(body: unknown): Readable {
    if (body instanceof Readable) {
      return body;
    }
    throw new Error('Object storage returned an unsupported response body.');
  }

  private required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required.`);
    }
    return value;
  }

  private boolean(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    return value === undefined ? fallback : value.toLowerCase() === 'true';
  }
}
