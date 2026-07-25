import { IsString, IsUUID, Length } from 'class-validator';

export class SendChatMessageDto {
  @IsUUID()
  clientMessageId!: string;

  @IsString()
  @Length(1, 2000)
  body!: string;
}
