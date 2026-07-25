import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  MediaUploadStatus,
  OwnershipVerificationStatus,
  PropertyListingType,
  PropertyMediaType,
  PropertyStatus,
} from '../generated/prisma/client';
import type { UploadPropertyMediaDto } from './dto/upload-property-media.dto';
import { LocalMediaStorageService } from './local-media-storage.service';

const run = promisify(execFile);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 180;

@Injectable()
export class MediaProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalMediaStorageService,
  ) {}

  async process(
    userId: string,
    propertyId: string,
    file: Express.Multer.File,
    dto: UploadPropertyMediaDto,
  ) {
    const property = await this.prisma.property.findFirst({
      where: {
        id: propertyId,
        brokerUserId: userId,
        status: { in: [PropertyStatus.DRAFT, PropertyStatus.REJECTED] },
      },
      select: { id: true },
    });
    if (!property) {
      await this.removeStaging(file.path);
      throw new ForbiddenException(
        '초안 또는 반려 상태의 본인 매물에만 미디어를 추가할 수 있습니다.',
      );
    }

    let mediaType: PropertyMediaType;
    try {
      mediaType = this.mediaType(file.mimetype);
      this.validateInputSize(mediaType, file.size);
      await this.assertMediaLimit(propertyId, mediaType, dto.isPublic);
    } catch (error: unknown) {
      await this.removeStaging(file.path);
      throw error;
    }

    const uploadId = createId();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await this.prisma.propertyMediaUpload.create({
        data: {
          id: uploadId,
          propertyId,
          userId,
          mediaType,
          originalFileName: file.originalname,
          originalMimeType: file.mimetype,
          originalSizeBytes: BigInt(file.size),
          status: MediaUploadStatus.PROCESSING,
          expiresAt,
        },
      });
    } catch (error: unknown) {
      await this.removeStaging(file.path);
      throw error;
    }

    try {
      const processed =
        mediaType === PropertyMediaType.IMAGE
          ? await this.processImage(uploadId, file.path)
          : await this.processVideo(uploadId, file.path);
      const propertyMediaId = createId();
      const media = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.propertyMedia.create({
          data: {
            id: propertyMediaId,
            propertyId,
            type: mediaType,
            url: `/v1/media/${uploadId}/content`,
            thumbnailUrl: `/v1/media/${uploadId}/thumbnail`,
            sortOrder: dto.sortOrder,
            isPublic: dto.isPublic,
          },
        });
        await transaction.propertyMediaUpload.update({
          where: { id: uploadId },
          data: {
            propertyMediaId,
            status: MediaUploadStatus.READY,
            storageKey: processed.outputKey,
            thumbnailStorageKey: processed.thumbnailKey,
            outputMimeType: processed.mimeType,
            outputSizeBytes: processed.outputSizeBytes,
            width: processed.width,
            height: processed.height,
            durationSeconds: processed.durationSeconds,
            errorCode: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: userId,
            action: 'PROPERTY_MEDIA.PROCESS',
            targetType: 'PropertyMedia',
            targetId: propertyMediaId,
            afterData: {
              propertyId,
              mediaType,
              outputSizeBytes: processed.outputSizeBytes.toString(),
            },
          },
        });
        return created;
      });
      return {
        ...media,
        processing: {
          uploadId,
          status: MediaUploadStatus.READY,
          width: processed.width,
          height: processed.height,
          durationSeconds: processed.durationSeconds,
          originalSizeBytes: file.size.toString(),
          outputSizeBytes: processed.outputSizeBytes.toString(),
        },
      };
    } catch (error: unknown) {
      await this.storage.removeUpload(uploadId);
      await this.prisma.propertyMediaUpload.update({
        where: { id: uploadId },
        data: {
          status: MediaUploadStatus.FAILED,
          errorCode: this.errorCode(error),
        },
      });
      throw error;
    } finally {
      await this.removeStaging(file.path);
    }
  }

  async publicFile(
    uploadId: string,
    variant: 'content' | 'thumbnail',
  ): Promise<string> {
    const upload = await this.prisma.propertyMediaUpload.findFirst({
      where: {
        id: uploadId,
        status: MediaUploadStatus.READY,
        property: {
          status: PropertyStatus.ACTIVE,
          OR: [
            { listingType: PropertyListingType.BROKERAGE },
            {
              listingType: PropertyListingType.OWNER_DIRECT,
              ownershipVerification: {
                status: OwnershipVerificationStatus.VERIFIED,
              },
            },
          ],
        },
        propertyMedia: { isPublic: true },
      },
      select: {
        storageKey: true,
        thumbnailStorageKey: true,
      },
    });
    const key =
      variant === 'content'
        ? upload?.storageKey
        : upload?.thumbnailStorageKey;
    if (!key) {
      throw new NotFoundException('공개 미디어를 찾을 수 없습니다.');
    }
    return this.storage.resolveKey(key);
  }

  async previewFile(
    userId: string,
    uploadId: string,
    variant: 'content' | 'thumbnail',
  ): Promise<string> {
    const upload = await this.prisma.propertyMediaUpload.findFirst({
      where: { id: uploadId, status: MediaUploadStatus.READY },
      select: {
        userId: true,
        storageKey: true,
        thumbnailStorageKey: true,
      },
    });
    if (!upload) {
      throw new NotFoundException('미디어를 찾을 수 없습니다.');
    }
    if (upload.userId !== userId) {
      const permission = await this.prisma.rolePermission.findFirst({
        where: {
          permission: { code: 'PROPERTY.APPROVE' },
          role: {
            users: {
              some: {
                userId,
                startsAt: { lte: new Date() },
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            },
          },
        },
        select: { roleId: true },
      });
      if (!permission) {
        throw new ForbiddenException('미디어 미리보기 권한이 없습니다.');
      }
    }
    const key =
      variant === 'content' ? upload.storageKey : upload.thumbnailStorageKey;
    if (!key) {
      throw new NotFoundException('미디어 파일을 찾을 수 없습니다.');
    }
    return this.storage.resolveKey(key);
  }

  async processImage(uploadId: string, inputPath: string) {
    const paths = await this.storage.prepare(uploadId, 'webp');
    const info = await sharp(inputPath)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 4 })
      .toFile(paths.outputPath);
    await sharp(paths.outputPath)
      .resize({ width: 640, height: 480, fit: 'cover' })
      .jpeg({ quality: 75, progressive: true })
      .toFile(paths.thumbnailPath);
    return {
      outputKey: paths.outputKey,
      thumbnailKey: paths.thumbnailKey,
      mimeType: 'image/webp',
      outputSizeBytes: BigInt(info.size),
      width: info.width,
      height: info.height,
      durationSeconds: null,
    };
  }

  async processVideo(uploadId: string, inputPath: string) {
    const metadata = await this.videoMetadata(inputPath);
    if (metadata.durationSeconds > MAX_VIDEO_SECONDS) {
      throw new BadRequestException('매물 동영상은 최대 3분입니다.');
    }
    const paths = await this.storage.prepare(uploadId, 'mp4');
    await run('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-vf',
      "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '28',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      paths.outputPath,
    ]);
    const outputMetadata = await this.videoMetadata(paths.outputPath);
    await run('ffmpeg', [
      '-y',
      '-ss',
      '00:00:01.000',
      '-i',
      paths.outputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '4',
      paths.thumbnailPath,
    ]);
    const outputSizeBytes = await this.storage.size(paths.outputPath);
    return {
      outputKey: paths.outputKey,
      thumbnailKey: paths.thumbnailKey,
      mimeType: 'video/mp4',
      outputSizeBytes,
      width: outputMetadata.width,
      height: outputMetadata.height,
      durationSeconds: Math.ceil(outputMetadata.durationSeconds),
    };
  }

  private async videoMetadata(inputPath: string): Promise<{
    durationSeconds: number;
    width: number | null;
    height: number | null;
  }> {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=width,height',
      '-of',
      'json',
      inputPath,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ width?: number; height?: number }>;
    };
    const durationSeconds = Number(parsed.format?.duration ?? 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new BadRequestException('동영상 정보를 읽을 수 없습니다.');
    }
    return {
      durationSeconds,
      width: parsed.streams?.[0]?.width ?? null,
      height: parsed.streams?.[0]?.height ?? null,
    };
  }

  private async assertMediaLimit(
    propertyId: string,
    type: PropertyMediaType,
    isPublic: boolean,
  ): Promise<void> {
    const media = await this.prisma.propertyMedia.findMany({
      where: { propertyId, type },
      select: { isPublic: true },
    });
    const totalLimit = type === PropertyMediaType.IMAGE ? 20 : 3;
    const publicLimit = type === PropertyMediaType.IMAGE ? 10 : 1;
    if (media.length >= totalLimit) {
      throw new ConflictException(
        type === PropertyMediaType.IMAGE
          ? '이미지는 최대 20개입니다.'
          : '동영상은 최대 3개입니다.',
      );
    }
    if (isPublic && media.filter((item) => item.isPublic).length >= publicLimit) {
      throw new ConflictException(
        type === PropertyMediaType.IMAGE
          ? '공개 이미지는 최대 10개입니다.'
          : '공개 동영상은 최대 1개입니다.',
      );
    }
  }

  private mediaType(mimeType: string): PropertyMediaType {
    if (
      [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
      ].includes(mimeType)
    ) {
      return PropertyMediaType.IMAGE;
    }
    if (['video/mp4', 'video/quicktime', 'video/webm'].includes(mimeType)) {
      return PropertyMediaType.VIDEO;
    }
    throw new BadRequestException('지원하지 않는 미디어 형식입니다.');
  }

  private validateInputSize(type: PropertyMediaType, bytes: number): void {
    const limit =
      type === PropertyMediaType.IMAGE ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (bytes <= 0 || bytes > limit) {
      throw new BadRequestException(
        type === PropertyMediaType.IMAGE
          ? '이미지는 20MB 이하여야 합니다.'
          : '동영상은 500MB 이하여야 합니다.',
      );
    }
  }

  private errorCode(error: unknown): string {
    if (error instanceof BadRequestException) {
      return 'INVALID_MEDIA';
    }
    return 'PROCESSING_FAILED';
  }

  private async removeStaging(path: string): Promise<void> {
    await unlink(path).catch(() => undefined);
  }
}
