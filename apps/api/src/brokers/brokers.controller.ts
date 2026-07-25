import { Body, Controller, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import {
  BrokerRegistrationService,
  type BrokerRegistrationResult,
} from './broker-registration.service';
import { CreateBrokerRegistrationDto } from './dto/create-broker-registration.dto';

@Controller('brokers')
export class BrokersController {
  constructor(private readonly registrations: BrokerRegistrationService) {}

  @Permissions('BROKER.REGISTRATION.CREATE')
  @MenuAccess('BROKER_REGISTRATION', 'write')
  @Post('registrations')
  async createRegistration(
    @Body() dto: CreateBrokerRegistrationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BrokerRegistrationResult> {
    return this.registrations.create(request.auth.sub, dto);
  }
}
