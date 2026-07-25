import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVisitReservationDto {
  @IsISO8601({ strict: true })
  startAt!: string;

  @IsISO8601({ strict: true })
  endAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
