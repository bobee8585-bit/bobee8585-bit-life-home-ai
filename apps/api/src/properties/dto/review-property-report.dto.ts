import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsString,
  Length,
} from 'class-validator';
import { PropertyReportStatus } from '../../generated/prisma/client';

export class ReviewPropertyReportDto {
  @IsEnum(PropertyReportStatus)
  status!: PropertyReportStatus;

  @IsString()
  @Length(2, 2000)
  resolution!: string;

  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true',
  )
  @IsBoolean()
  deactivateProperty = false;
}
