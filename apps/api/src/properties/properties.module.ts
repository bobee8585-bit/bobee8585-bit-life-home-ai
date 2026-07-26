import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AdminPropertiesController } from './admin-properties.controller';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { MediaObjectStorageService } from './media-object-storage.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaProcessingQueueService } from './media-processing-queue.service';
import { MediaWorkspaceService } from './media-workspace.service';
import { PropertyMediaController } from './property-media.controller';
import { PropertyReportsController } from './property-reports.controller';
import { PropertyReportsService } from './property-reports.service';
import { CurrencyModule } from '../currency/currency.module';
import { AuthModule } from '../auth/auth.module';
import { LeaseSafetyService } from './lease-safety.service';
import { SavedPropertySearchesController } from './saved-property-searches.controller';
import { SavedPropertySearchesService } from './saved-property-searches.service';

@Module({
  imports: [DatabaseModule, CurrencyModule, AuthModule],
  controllers: [
    PropertiesController,
    AdminPropertiesController,
    PropertyMediaController,
    PropertyReportsController,
    SavedPropertySearchesController,
  ],
  providers: [
    PropertiesService,
    MediaObjectStorageService,
    MediaWorkspaceService,
    MediaProcessingQueueService,
    MediaProcessingService,
    PropertyReportsService,
    LeaseSafetyService,
    SavedPropertySearchesService,
  ],
  exports: [MediaProcessingService],
})
export class PropertiesModule {}
