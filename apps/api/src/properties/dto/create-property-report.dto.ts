import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';
import { PropertyReportReason } from '../../generated/prisma/client';

export class CreatePropertyReportDto {
  @IsEnum(PropertyReportReason)
  reason!: PropertyReportReason;

  @IsString()
  @Length(10, 2000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({ require_protocol: true }, { each: true })
  @MaxLength(2000, { each: true })
  evidenceUrls: string[] = [];
}
