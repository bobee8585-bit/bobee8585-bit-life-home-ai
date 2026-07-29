import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
  Prisma,
  PropertyChangeType,
  PropertyDealStatus,
  PropertyListingType,
  PropertyMediaType,
  PropertyStatus,
} from '../generated/prisma/client';
import type { UploadPropertyMediaDto } from './dto/upload-property-media.dto';
import {
  MediaObjectStorageService,
  type StoredMediaObject,
} from './media-object-storage.service';
import { MediaProcessingQueueService } from './media-processing-queue.service';
import {
  MediaWorkspaceService,
  type MediaWorkspace,
} from './media-workspace.service';
import { PropertyWatchesService } from './property-watches.service';

const run = promisify(execFile);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 180;

interface ProcessedMedia {
  outputPath: string;
  outputKey: string;
  thumbnailPath: string;
  thumbnailKey: string;
  mimeType: string;
  outputSizeBytes: bigint;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface MediaFileResponse extends StoredMediaObject {
  contentType: string;
}

@Injectable()
export class MediaProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaObjectStorageService,
    private readonly workspace: MediaWorkspaceService,
    private readonly queue: MediaProcessingQueueService,
    private readonly watches: PropertyWatchesService,
  ) {}

  async requestUpload(
    userId: string,
    propertyId: string,
    file: Express.Multer.File,
    dto: UploadPropertyMediaDto,
  ) {
    try {
      const property = await this.prisma.property.findFirst({
        where: {
          id: propertyId,
          brokerUserId: userId,
          OR: [
            {
              status: {
                in: [PropertyStatus.DRAFT, PropertyStatus.REJECTED],
              },
            },
            {
              status: PropertyStatus.ACTIVE,
              dealStatus: {
                in: [
                  PropertyDealStatus.AVAILABLE,
                  PropertyDealStatus.RESERVED,
                  PropertyDealStatus.CONTRACTING,
                ],
              },
            },
          ],
        },
        select: { id: true },
      });
      if (!property) {
        throw new ForbiddenException(
          '수정 가능한 본인 매물에만 미디어를 추가할 수 있습니다.',
        );
      }

      const mediaType = this.mediaType(file.mimetype);
      this.validateInputSize(mediaType, file.size);
      await this.assertMediaLimit(propertyId, mediaType, dto.isPublic);

      const uploadId = createId();
      const originalStorageKey = `originals/${uploadId}/source`;
      await this.storage.putFile(
        originalStorageKey,
        file.path,
        file.mimetype,
      );
      const now = new Date();
      try {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw(
            Prisma.sql`SELECT "id" FROM "properties"
              WHERE "id" = ${propertyId}::uuid FOR UPDATE`,
          );
          const lockedProperty = await transaction.property.findFirst({
            where: {
              id: propertyId,
              brokerUserId: userId,
              OR: [
                {
                  status: {
                    in: [PropertyStatus.DRAFT, PropertyStatus.REJECTED],
                  },
                },
                {
                  status: PropertyStatus.ACTIVE,
                  dealStatus: {
                    in: [
                      PropertyDealStatus.AVAILABLE,
                      PropertyDealStatus.RESERVED,
                      PropertyDealStatus.CONTRACTING,
                    ],
                  },
                },
              ],
            },
            select: { id: true },
          });
          if (!lockedProperty) {
            throw new ConflictException(
              '매물 상태가 변경되어 미디어를 추가할 수 없습니다.',
            );
          }
          await this.assertMediaLimit(
            propertyId,
            mediaType,
            dto.isPublic,
            transaction,
          );
          await transaction.propertyMediaUpload.create({
            data: {
              id: uploadId,
              propertyId,
              userId,
              mediaType,
              originalFileName: file.originalname,
              originalMimeType: file.mimetype,
              originalSizeBytes: BigInt(file.size),
              requestedIsPublic: dto.isPublic,
              requestedSortOrder: dto.sortOrder,
              status: MediaUploadStatus.REQUESTED,
              originalStorageKey,
              queuedAt: now,
              expiresAt: new Date(
                now.getTime() + 24 * 60 * 60 * 1_000,
              ),
            },
          });
        });
      } catch (error: unknown) {
        await this.storage.remove(originalStorageKey).catch(() => undefined);
        throw error;
      }

      try {
        await this.queue.enqueue(uploadId);
      } catch {
        await Promise.all([
          this.storage.remove(originalStorageKey).catch(() => undefined),
          this.prisma.propertyMediaUpload.update({
            where: { id: uploadId },
            data: {
              status: MediaUploadStatus.FAILED,
              errorCode: 'QUEUE_UNAVAILABLE',
              completedAt: new Date(),
              originalStorageKey: null,
            },
          }),
        ]);
        throw new ServiceUnavailableException(
          '미디어 작업 큐에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }

      return {
        uploadId,
        propertyId,
        mediaType,
        status: MediaUploadStatus.REQUESTED,
        storageProvider: this.storage.storageProvider(),
        queuedAt: now.toISOString(),
        statusUrl: `/v1/media-uploads/${uploadId}`,
      };
    } finally {
      await this.removeStaging(file.path);
    }
  }

  async uploadStatus(userId: string, uploadId: string) {
    const upload = await this.prisma.propertyMediaUpload.findFirst({
      where: { id: uploadId, userId },
      select: {
        id: true,
        propertyId: true,
        propertyMediaId: true,
        mediaType: true,
        status: true,
        attempts: true,
        errorCode: true,
        originalSizeBytes: true,
        outputSizeBytes: true,
        width: true,
        height: true,
        durationSeconds: true,
        queuedAt: true,
        processingStartedAt: true,
        completedAt: true,
      },
    });
    if (!upload) {
      throw new NotFoundException('미디어 업로드를 찾을 수 없습니다.');
    }
    return {
      uploadId: upload.id,
      propertyId: upload.propertyId,
      propertyMediaId: upload.propertyMediaId,
      mediaType: upload.mediaType,
      status: upload.status,
      attempts: upload.attempts,
      errorCode: upload.errorCode,
      originalSizeBytes: upload.originalSizeBytes.toString(),
      outputSizeBytes: upload.outputSizeBytes?.toString() ?? null,
      width: upload.width,
      height: upload.height,
      durationSeconds: upload.durationSeconds,
      queuedAt: upload.queuedAt?.toISOString() ?? null,
      processingStartedAt:
        upload.processingStartedAt?.toISOString() ?? null,
      completedAt: upload.completedAt?.toISOString() ?? null,
    };
  }

  async processQueuedUpload(
    uploadId: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<void> {
    const upload = await this.prisma.propertyMediaUpload.findUnique({
      where: { id: uploadId },
    });
    if (!upload || upload.status === MediaUploadStatus.READY) {
      return;
    }
    if (
      upload.status === MediaUploadStatus.FAILED ||
      !upload.originalStorageKey
    ) {
      throw new NotFoundException('처리할 미디어 원본을 찾을 수 없습니다.');
    }

    await this.prisma.propertyMediaUpload.update({
      where: { id: uploadId },
      data: {
        status: MediaUploadStatus.PROCESSING,
        attempts: attempt,
        processingStartedAt: new Date(),
        errorCode: null,
      },
    });

    let processed: ProcessedMedia | undefined;
    try {
      const work = await this.workspace.prepare(
        uploadId,
        upload.mediaType === PropertyMediaType.IMAGE ? 'webp' : 'mp4',
      );
      await this.storage.getFile(upload.originalStorageKey, work.inputPath);
      processed =
        upload.mediaType === PropertyMediaType.IMAGE
          ? await this.processImage(work)
          : await this.processVideo(work);
      await Promise.all([
        this.storage.putFile(
          processed.outputKey,
          processed.outputPath,
          processed.mimeType,
        ),
        this.storage.putFile(
          processed.thumbnailKey,
          processed.thumbnailPath,
          'image/jpeg',
        ),
      ]);

      const propertyMediaId = createId();
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.propertyMediaUpload.findUnique({
          where: { id: uploadId },
          select: { status: true, propertyMediaId: true },
        });
        if (!current || current.status === MediaUploadStatus.READY) {
          return;
        }
        await transaction.propertyMedia.create({
          data: {
            id: propertyMediaId,
            propertyId: upload.propertyId,
            type: upload.mediaType,
            url: `/v1/media/${uploadId}/content`,
            thumbnailUrl: `/v1/media/${uploadId}/thumbnail`,
            sortOrder: upload.requestedSortOrder,
            isPublic: upload.requestedIsPublic,
          },
        });
        await transaction.propertyMediaUpload.update({
          where: { id: uploadId },
          data: {
            propertyMediaId,
            status: MediaUploadStatus.READY,
            originalStorageKey: null,
            storageKey: processed!.outputKey,
            thumbnailStorageKey: processed!.thumbnailKey,
            outputMimeType: processed!.mimeType,
            outputSizeBytes: processed!.outputSizeBytes,
            width: processed!.width,
            height: processed!.height,
            durationSeconds: processed!.durationSeconds,
            errorCode: null,
            completedAt: new Date(),
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: upload.userId,
            action: 'PROPERTY_MEDIA.PROCESS',
            targetType: 'PropertyMedia',
            targetId: propertyMediaId,
            afterData: {
              propertyId: upload.propertyId,
              mediaType: upload.mediaType,
              outputSizeBytes: processed!.outputSizeBytes.toString(),
              storageProvider: this.storage.storageProvider(),
              attempt,
            },
          },
        });
        if (
          upload.mediaType === PropertyMediaType.IMAGE &&
          upload.requestedIsPublic
        ) {
          const property = await transaction.property.findUniqueOrThrow({
            where: { id: upload.propertyId },
            select: {
              listingNumber: true,
              status: true,
            },
          });
          if (property.status === PropertyStatus.ACTIVE) {
            await this.watches.recordChange(transaction, {
              propertyId: upload.propertyId,
              listingNumber: property.listingNumber,
              actorUserId: upload.userId,
              type: PropertyChangeType.PHOTO,
              before: { action: 'ADD', mediaId: null },
              after: {
                action: 'ADD',
                mediaId: propertyMediaId,
                mediaType: upload.mediaType,
              },
            });
          }
        }
      });
      await this.storage
        .remove(upload.originalStorageKey)
        .catch(() => undefined);
    } catch (error: unknown) {
      const terminal = this.permanent(error) || attempt >= maxAttempts;
      if (processed) {
        await this.storage
          .removeMany([processed.outputKey, processed.thumbnailKey])
          .catch(() => undefined);
      }
      await this.prisma.propertyMediaUpload.updateMany({
        where: { id: uploadId, status: { not: MediaUploadStatus.READY } },
        data: {
          status: terminal
            ? MediaUploadStatus.FAILED
            : MediaUploadStatus.REQUESTED,
          errorCode: this.errorCode(error),
          completedAt: terminal ? new Date() : null,
          ...(terminal ? { originalStorageKey: null } : {}),
        },
      });
      if (terminal) {
        await this.storage
          .remove(upload.originalStorageKey)
          .catch(() => undefined);
      }
      throw error;
    } finally {
      await this.workspace.cleanup(uploadId);
    }
  }

  async publicFile(
    uploadId: string,
    variant: 'content' | 'thumbnail',
  ): Promise<MediaFileResponse> {
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
        outputMimeType: true,
      },
    });
    const key =
      variant === 'content'
        ? upload?.storageKey
        : upload?.thumbnailStorageKey;
    if (!key) {
      throw new NotFoundException('공개 미디어를 찾을 수 없습니다.');
    }
    return {
      ...(await this.storage.open(key)),
      contentType:
        variant === 'thumbnail'
          ? 'image/jpeg'
          : (upload?.outputMimeType ?? 'application/octet-stream'),
    };
  }

  async previewFile(
    userId: string,
    uploadId: string,
    variant: 'content' | 'thumbnail',
  ): Promise<MediaFileResponse> {
    const upload = await this.prisma.propertyMediaUpload.findFirst({
      where: { id: uploadId, status: MediaUploadStatus.READY },
      select: {
        userId: true,
        storageKey: true,
        thumbnailStorageKey: true,
        outputMimeType: true,
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
    return {
      ...(await this.storage.open(key)),
      contentType:
        variant === 'thumbnail'
          ? 'image/jpeg'
          : (upload.outputMimeType ?? 'application/octet-stream'),
    };
  }

  async deleteMedia(
    userId: string,
    propertyId: string,
    mediaId: string,
  ) {
    const existing = await this.prisma.propertyMedia.findFirst({
      where: {
        id: mediaId,
        propertyId,
        property: { brokerUserId: userId },
      },
      select: {
        id: true,
        type: true,
        isPublic: true,
        upload: {
          select: {
            id: true,
            originalStorageKey: true,
            storageKey: true,
            thumbnailStorageKey: true,
          },
        },
        property: {
          select: {
            listingNumber: true,
            status: true,
            dealStatus: true,
          },
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('매물 미디어를 찾을 수 없습니다.');
    }
    this.assertMediaEditable(existing.property.status, existing.property.dealStatus);
    const keys = [
      existing.upload?.originalStorageKey,
      existing.upload?.storageKey,
      existing.upload?.thumbnailStorageKey,
    ];
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "properties"
          WHERE "id" = ${propertyId}::uuid FOR UPDATE`,
      );
      const current = await transaction.propertyMedia.findFirst({
        where: {
          id: mediaId,
          propertyId,
          property: { brokerUserId: userId },
        },
        select: {
          id: true,
          type: true,
          isPublic: true,
          upload: { select: { id: true } },
          property: {
            select: {
              listingNumber: true,
              status: true,
              dealStatus: true,
            },
          },
        },
      });
      if (!current) {
        throw new ConflictException('미디어가 이미 삭제되었습니다.');
      }
      this.assertMediaEditable(current.property.status, current.property.dealStatus);
      if (
        current.property.status === PropertyStatus.ACTIVE &&
        current.type === PropertyMediaType.IMAGE &&
        current.isPublic
      ) {
        const publicImages = await transaction.propertyMedia.count({
          where: {
            propertyId,
            type: PropertyMediaType.IMAGE,
            isPublic: true,
          },
        });
        if (publicImages <= 1) {
          throw new ConflictException(
            '활성 매물의 마지막 공개 이미지는 삭제할 수 없습니다.',
          );
        }
      }
      await transaction.propertyMedia.delete({ where: { id: mediaId } });
      if (current.upload) {
        await transaction.propertyMediaUpload.update({
          where: { id: current.upload.id },
          data: {
            propertyMediaId: null,
            originalStorageKey: null,
            storageKey: null,
            thumbnailStorageKey: null,
          },
        });
      }
      if (
        current.property.status === PropertyStatus.ACTIVE &&
        current.type === PropertyMediaType.IMAGE &&
        current.isPublic
      ) {
        await this.watches.recordChange(transaction, {
          propertyId,
          listingNumber: current.property.listingNumber,
          actorUserId: userId,
          type: PropertyChangeType.PHOTO,
          before: {
            action: 'DELETE',
            mediaId,
            mediaType: current.type,
          },
          after: { action: 'DELETE', mediaId: null },
        });
      }
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: userId,
          action: 'PROPERTY_MEDIA.DELETE',
          targetType: 'PropertyMedia',
          targetId: mediaId,
          beforeData: {
            propertyId,
            type: current.type,
            isPublic: current.isPublic,
          },
        },
      });
    });
    await this.storage.removeMany(keys);
    return { id: mediaId, propertyId, deleted: true };
  }

  async processImage(work: MediaWorkspace): Promise<ProcessedMedia> {
    const info = await sharp(work.inputPath)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 4 })
      .toFile(work.outputPath);
    await sharp(work.outputPath)
      .resize({ width: 640, height: 480, fit: 'cover' })
      .jpeg({ quality: 75, progressive: true })
      .toFile(work.thumbnailPath);
    return {
      ...work,
      mimeType: 'image/webp',
      outputSizeBytes: BigInt(info.size),
      width: info.width,
      height: info.height,
      durationSeconds: null,
    };
  }

  async processVideo(work: MediaWorkspace): Promise<ProcessedMedia> {
    const metadata = await this.videoMetadata(work.inputPath);
    if (metadata.durationSeconds > MAX_VIDEO_SECONDS) {
      throw new BadRequestException('매물 동영상은 최대 3분입니다.');
    }
    await run('ffmpeg', [
      '-y',
      '-i',
      work.inputPath,
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
      work.outputPath,
    ]);
    const outputMetadata = await this.videoMetadata(work.outputPath);
    await run('ffmpeg', [
      '-y',
      '-ss',
      '00:00:01.000',
      '-i',
      work.outputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '4',
      work.thumbnailPath,
    ]);
    return {
      ...work,
      mimeType: 'video/mp4',
      outputSizeBytes: await this.workspace.size(work.outputPath),
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
    database:
      | PrismaService
      | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const [ready, pending] = await Promise.all([
      database.propertyMedia.findMany({
        where: { propertyId, type },
        select: { isPublic: true },
      }),
      database.propertyMediaUpload.findMany({
        where: {
          propertyId,
          mediaType: type,
          status: {
            in: [MediaUploadStatus.REQUESTED, MediaUploadStatus.PROCESSING],
          },
        },
        select: { requestedIsPublic: true },
      }),
    ]);
    const totalLimit = type === PropertyMediaType.IMAGE ? 20 : 3;
    const publicLimit = type === PropertyMediaType.IMAGE ? 10 : 1;
    if (ready.length + pending.length >= totalLimit) {
      throw new ConflictException(
        type === PropertyMediaType.IMAGE
          ? '이미지는 처리 대기 항목을 포함해 최대 20개입니다.'
          : '동영상은 처리 대기 항목을 포함해 최대 3개입니다.',
      );
    }
    const publicCount =
      ready.filter((item) => item.isPublic).length +
      pending.filter((item) => item.requestedIsPublic).length;
    if (isPublic && publicCount >= publicLimit) {
      throw new ConflictException(
        type === PropertyMediaType.IMAGE
          ? '공개 이미지는 처리 대기 항목을 포함해 최대 10개입니다.'
          : '공개 동영상은 처리 대기 항목을 포함해 최대 1개입니다.',
      );
    }
  }

  private assertMediaEditable(
    status: PropertyStatus,
    dealStatus: PropertyDealStatus,
  ): void {
    const draftEditable =
      status === PropertyStatus.DRAFT || status === PropertyStatus.REJECTED;
    const editableDealStatuses: PropertyDealStatus[] = [
      PropertyDealStatus.AVAILABLE,
      PropertyDealStatus.RESERVED,
      PropertyDealStatus.CONTRACTING,
    ];
    const activeEditable =
      status === PropertyStatus.ACTIVE &&
      editableDealStatuses.includes(dealStatus);
    if (!draftEditable && !activeEditable) {
      throw new ConflictException('현재 매물 상태에서는 미디어를 변경할 수 없습니다.');
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

  private permanent(error: unknown): boolean {
    return error instanceof HttpException && error.getStatus() < 500;
  }

  private errorCode(error: unknown): string {
    if (error instanceof BadRequestException) {
      return 'INVALID_MEDIA';
    }
    if (error instanceof NotFoundException) {
      return 'SOURCE_MISSING';
    }
    return 'PROCESSING_FAILED';
  }

  private async removeStaging(path: string): Promise<void> {
    await unlink(path).catch(() => undefined);
  }
}
