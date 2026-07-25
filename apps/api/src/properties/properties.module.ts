import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AdminPropertiesController } from './admin-properties.controller';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { LocalMediaStorageService } from './local-media-storage.service';
import { MediaProcessingService } from './media-processing.service';
import { PropertyMediaController } from './property-media.controller';
import { PropertyReportsController } from './property-reports.controller';
import { PropertyReportsService } from './property-reports.service';
import { CurrencyModule } from '../currency/currency.module';

@Module({
  imports: [DatabaseModule, CurrencyModule],
  controllers: [
    PropertiesController,
    AdminPropertiesController,
    PropertyMediaController,
    PropertyReportsController,
  ],
  providers: [
    PropertiesService,
    LocalMediaStorageService,
    MediaProcessingService,
    PropertyReportsService,
  ],
})
export class PropertiesModule {}
