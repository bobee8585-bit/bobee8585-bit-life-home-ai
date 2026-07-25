import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BrokerRegistrationService } from './broker-registration.service';
import { BrokersController } from './brokers.controller';
import { AdminBrokerRegistrationsController } from './admin-broker-registrations.controller';
import { BrokerReviewService } from './broker-review.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [BrokersController, AdminBrokerRegistrationsController],
  providers: [BrokerRegistrationService, BrokerReviewService],
})
export class BrokersModule {}
