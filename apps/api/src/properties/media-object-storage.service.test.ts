import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaObjectStorageService } from './media-object-storage.service';

const roots: string[] = [];

afterEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MEDIA_STORAGE_MODE = 'local';
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('MediaObjectStorageService', () => {
  it('stores and retrieves private objects through the local adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifehome-object-test-'));
    roots.push(root);
    process.env.MEDIA_STORAGE_MODE = 'local';
    process.env.MEDIA_STORAGE_ROOT = join(root, 'objects');
    const storage = new MediaObjectStorageService();
    const source = join(root, 'source.txt');
    const destination = join(root, 'downloaded.txt');
    await writeFile(source, 'life-home-media');

    await storage.putFile('originals/upload/source', source, 'text/plain');
    await storage.getFile('originals/upload/source', destination);

    await expect(readFile(destination, 'utf8')).resolves.toBe(
      'life-home-media',
    );
    await storage.remove('originals/upload/source');
    await expect(
      storage.getFile('originals/upload/source', destination),
    ).rejects.toThrow();
  });

  it('rejects local object storage in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MEDIA_STORAGE_MODE = 'local';

    expect(() => new MediaObjectStorageService()).toThrow(
      'Production media storage must use s3 mode.',
    );
  });
});
