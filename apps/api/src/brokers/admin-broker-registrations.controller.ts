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
import { BrokerReviewService } from './broker-review.service';
import { ListBrokerRegistrationsDto } from './dto/list-broker-registrations.dto';
import { ReviewBrokerRegistrationDto } from './dto/review-broker-registration.dto';

@Permissions('BROKER.APPROVE')
@Controller('admin/broker-registrations')
export class AdminBrokerRegistrationsController {
  constructor(private readonly reviews: BrokerReviewService) {}

  @MenuAccess('BROKER_REVIEW', 'read')
  @Get()
  list(@Query() query: ListBrokerRegistrationsDto) {
    return this.reviews.list(query);
  }

  @MenuAccess('BROKER_REVIEW', 'write')
  @Post(':userId/approve')
  approve(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReviewBrokerRegistrationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviews.approve(userId, request.auth.sub, dto.reason);
  }

  @MenuAccess('BROKER_REVIEW', 'write')
  @Post(':userId/reject')
  reject(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReviewBrokerRegistrationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviews.reject(userId, request.auth.sub, dto.reason);
  }
}
