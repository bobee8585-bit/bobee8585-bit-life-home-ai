import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { Platform } from '../../generated/prisma/client';

export class RegisterPushEndpointDto {
  @IsUUID()
  deviceId!: string;

  @IsIn([Platform.ANDROID, Platform.IOS])
  platform!: Platform;

  @IsString()
  @Length(20, 4096)
  token!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;
}
