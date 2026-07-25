import { NestFactory } from '@nestjs/core';
import { MediaWorkerModule } from './properties/media-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MediaWorkerModule);
  app.enableShutdownHooks();
}

void bootstrap();
