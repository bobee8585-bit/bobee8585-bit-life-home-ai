import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { ListPropertyReviewsDto } from './dto/list-property-reviews.dto';
import { ReviewPropertyDto } from './dto/review-property.dto';
import { PropertiesService } from './properties.service';

@Controller('admin/properties')
export class AdminPropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Permissions('PROPERTY.APPROVE')
  @MenuAccess('PROPERTY_REVIEW', 'read')
  @Get()
  queue(@Query() query: ListPropertyReviewsDto) {
    return this.properties.reviewQueue(query);
  }

  @Permissions('PROPERTY.APPROVE')
  @MenuAccess('PROPERTY_REVIEW', 'write')
  @Post(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPropertyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.properties.approve(id, request.auth.sub, dto.reason);
  }

  @Permissions('PROPERTY.REJECT')
  @MenuAccess('PROPERTY_REVIEW', 'write')
  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPropertyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.properties.reject(id, request.auth.sub, dto.reason);
  }
}
