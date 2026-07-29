import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePropertyWatchDto {
  @IsOptional()
  @IsBoolean()
  alertOnPriceChange?: boolean;

  @IsOptional()
  @IsBoolean()
  alertOnPhotoChange?: boolean;

  @IsOptional()
  @IsBoolean()
  alertOnDealStatusChange?: boolean;
}
