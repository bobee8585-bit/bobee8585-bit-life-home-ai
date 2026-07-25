import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RegisterPushEndpointDto } from './dto/register-push-endpoint.dto';
import { NotificationEndpointsService } from './notification-endpoints.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly endpoints: NotificationEndpointsService) {}

  @Post('push-endpoints')
  registerPush(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RegisterPushEndpointDto,
  ) {
    return this.endpoints.registerPush(request.auth.sub, dto);
  }

  @Get('push-endpoints')
  list(@Req() request: AuthenticatedRequest) {
    return this.endpoints.list(request.auth.sub);
  }

  @Delete('push-endpoints/:deviceId')
  unregister(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.endpoints.unregister(request.auth.sub, deviceId);
  }
}
