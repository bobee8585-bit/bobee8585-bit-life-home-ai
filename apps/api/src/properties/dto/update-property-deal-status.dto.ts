import { IsDateString, IsEnum } from 'class-validator';
import { PropertyDealStatus } from '../../generated/prisma/client';

export class UpdatePropertyDealStatusDto {
  @IsEnum(PropertyDealStatus)
  dealStatus!: PropertyDealStatus;

  @IsDateString()
  expectedUpdatedAt!: string;
}
