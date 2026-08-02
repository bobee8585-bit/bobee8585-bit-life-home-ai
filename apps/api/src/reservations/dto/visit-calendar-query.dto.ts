import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class VisitCalendarQueryDto {
  @IsDateString({ strict: true })
  from!: string;

  @IsDateString({ strict: true })
  to!: string;

  @IsOptional()
  @IsString()
  timezone = 'Asia/Seoul';

  @IsOptional()
  @IsIn(['DRIVE', 'TRANSIT', 'WALK'])
  travelMode: 'DRIVE' | 'TRANSIT' | 'WALK' = 'DRIVE';
}
