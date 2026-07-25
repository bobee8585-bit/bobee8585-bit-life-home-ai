import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';

export class PropertyDisplayDto {
  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @Matches(/^[A-Z]{3}$/)
  displayCurrency = 'KRW';
}
