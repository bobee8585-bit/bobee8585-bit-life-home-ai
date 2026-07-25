import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { UploadPropertyMediaDto } from './dto/upload-property-media.dto';
import { MediaProcessingService } from './media-processing.service';

const stagingRoot =
  process.env.MEDIA_STAGING_ROOT ?? '/tmp/lifehome-media-staging';
mkdirSync(stagingRoot, { recursive: true });

@Controller()
export class PropertyMediaController {
  constructor(private readonly media: MediaProcessingService) {}

  @Permissions('PROPERTY.UPDATE')
  @MenuAccess('PROPERTY_MANAGE', 'write')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: stagingRoot,
        filename: (_request, _file, callback) =>
          callback(null, randomUUID()),
      }),
      limits: { fileSize: 500 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) => {
        const allowed =
          file.mimetype.startsWith('image/') ||
          file.mimetype.startsWith('video/');
        callback(
          allowed
            ? null
            : new BadRequestException('이미지 또는 동영상만 업로드할 수 있습니다.'),
          allowed,
        );
      },
    }),
  )
  @Post('properties/:propertyId/media')
  upload(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadPropertyMediaDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException('업로드할 파일이 필요합니다.');
    }
    return this.media.process(request.auth.sub, propertyId, file, dto);
  }

  @Public()
  @Get('media/:uploadId/:variant')
  async publicFile(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Param('variant') variant: string,
    @Res() response: Response,
  ) {
    const path = await this.media.publicFile(
      uploadId,
      this.variant(variant),
    );
    return response.sendFile(path);
  }

  @Get('media/:uploadId/:variant/preview')
  async previewFile(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Param('variant') variant: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const path = await this.media.previewFile(
      request.auth.sub,
      uploadId,
      this.variant(variant),
    );
    return response.sendFile(path);
  }

  private variant(value: string): 'content' | 'thumbnail' {
    if (value !== 'content' && value !== 'thumbnail') {
      throw new BadRequestException('미디어 유형이 올바르지 않습니다.');
    }
    return value;
  }
}
