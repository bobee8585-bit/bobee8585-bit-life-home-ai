import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsEnum, IsInt, IsNumberString, IsOptional, IsString,
  Max, MaxLength, Min, MinLength, Matches,
} from 'class-validator';
import { PropertyTransactionType, PropertyType } from '../../generated/prisma/client';

export class UpdateSavedPropertySearchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string | null;
  @IsOptional() @IsEnum(PropertyType) propertyType?: PropertyType | null;
  @IsOptional() @IsEnum(PropertyTransactionType) transactionType?: PropertyTransactionType | null;
  @IsOptional() @Transform(({ value }) => String(value).toUpperCase())
  @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsNumberString() minPrice?: string | null;
  @IsOptional() @IsNumberString() maxPrice?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minRooms?: number | null;
  @IsOptional() @IsBoolean() alertsEnabled?: boolean;
}
