import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

const ISO_CURRENCY = /^[A-Z]{3}$/;

export class RatePairDto {
  @Transform(({ value }) => String(value).toUpperCase())
  @Matches(ISO_CURRENCY)
  base!: string;

  @Transform(({ value }) => String(value).toUpperCase())
  @Matches(ISO_CURRENCY)
  quote!: string;
}
