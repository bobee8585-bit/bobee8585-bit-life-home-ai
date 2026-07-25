import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PropertyReportStatus } from '../../generated/prisma/client';

export class ListPropertyReportsDto {
  @IsOptional()
  @IsEnum(PropertyReportStatus)
  status?: PropertyReportStatus;

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
