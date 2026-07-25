import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PropertyStatus } from '../../generated/prisma/client';

export class ListPropertyReviewsDto {
  @IsOptional()
  @IsEnum(PropertyStatus)
  status: PropertyStatus = PropertyStatus.PENDING_REVIEW;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
