import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PropertyMediaType,
  PropertyTransactionType,
  PropertyType,
} from '../../generated/prisma/client';

export class CreatePropertyMediaDto {
  @IsEnum(PropertyMediaType)
  type!: PropertyMediaType;

  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  thumbnailUrl?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder!: number;

  @IsBoolean()
  isPublic!: boolean;
}

export class CreatePropertyDto {
  @IsString()
  @Length(5, 100)
  title!: string;

  @IsString()
  @Length(20, 5000)
  description!: string;

  @IsEnum(PropertyType)
  propertyType!: PropertyType;

  @IsEnum(PropertyTransactionType)
  transactionType!: PropertyTransactionType;

  @IsNumberString()
  price!: string;

  @IsOptional()
  @IsNumberString()
  deposit?: string;

  @IsOptional()
  @IsNumberString()
  monthlyRent?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency = 'KRW';

  @IsNumberString()
  exclusiveArea!: string;

  @IsOptional()
  @IsNumberString()
  supplyArea?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  rooms!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  bathrooms!: number;

  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  totalFloors?: number;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode = 'KR';

  @IsString()
  @Length(1, 50)
  region1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  region2?: string;

  @IsString()
  @Length(1, 80)
  city!: string;

  @IsString()
  @Length(5, 200)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsNumberString()
  latitude?: string;

  @IsOptional()
  @IsNumberString()
  longitude?: string;

  @IsArray()
  @ArrayMaxSize(23)
  @ValidateNested({ each: true })
  @Type(() => CreatePropertyMediaDto)
  media!: CreatePropertyMediaDto[];
}
