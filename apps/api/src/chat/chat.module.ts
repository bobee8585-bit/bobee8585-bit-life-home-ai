import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PropertyChatController } from './property-chat.controller';
import { PropertyChatService } from './property-chat.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PropertyChatController],
  providers: [PropertyChatService],
})
export class ChatModule {}
