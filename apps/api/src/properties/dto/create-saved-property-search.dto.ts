import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsEnum, IsInt, IsNumberString, IsOptional, IsString,
  Max, MaxLength, Min, MinLength, Matches,
} from 'class-validator';
import { PropertyTransactionType, PropertyType } from '../../generated/prisma/client';

export class CreateSavedPropertySearchDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsEnum(PropertyType) propertyType?: PropertyType;
  @IsOptional() @IsEnum(PropertyTransactionType) transactionType?: PropertyTransactionType;
  @IsOptional() @Transform(({ value }) => String(value).toUpperCase())
  @Matches(/^[A-Z]{3}$/) currency = 'KRW';
  @IsOptional() @IsNumberString() minPrice?: string;
  @IsOptional() @IsNumberString() maxPrice?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minRooms?: number;
  @IsOptional() @IsBoolean() alertsEnabled = true;
}
