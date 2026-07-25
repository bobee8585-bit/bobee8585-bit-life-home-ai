import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { VisitReservationStatus } from '../../generated/prisma/client';

export class ListVisitReservationsDto {
  @IsOptional()
  @IsEnum(VisitReservationStatus)
  status?: VisitReservationStatus;

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
