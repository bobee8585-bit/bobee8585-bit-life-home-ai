import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApproveVisitReservationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class ReservationReasonDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
