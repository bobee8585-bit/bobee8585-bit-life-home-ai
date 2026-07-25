import { Module } from '@nestjs/common';
import { PropertiesModule } from './properties.module';
import { MediaProcessingWorker } from './media-processing.worker';

@Module({
  imports: [PropertiesModule],
  providers: [MediaProcessingWorker],
})
export class MediaWorkerModule {}
