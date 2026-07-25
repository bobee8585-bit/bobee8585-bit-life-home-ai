import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationEndpointsService } from './notification-endpoints.service';
import { NotificationOutboxWorker } from './notification-outbox.worker';
import { NotificationProviderService } from './notification-provider.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationEndpointsService,
    NotificationOutboxWorker,
    NotificationProviderService,
    NotificationTemplateService,
  ],
  exports: [NotificationOutboxWorker],
})
export class NotificationsModule {}
