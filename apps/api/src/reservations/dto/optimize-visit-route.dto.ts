import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export enum VisitTravelMode {
  DRIVE = 'DRIVE',
  TRANSIT = 'TRANSIT',
  WALK = 'WALK',
}

export class OptimizeVisitRouteDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  propertyIds!: string[];

  @IsISO8601({ strict: true })
  departureAt!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  startLatitude!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  startLongitude!: number;

  @IsOptional()
  @IsEnum(VisitTravelMode)
  travelMode = VisitTravelMode.DRIVE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(180)
  visitDurationMinutes = 60;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  bufferMinutes = 15;

  @IsOptional()
  @IsISO8601({ strict: true })
  deadlineAt?: string;
}
