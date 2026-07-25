import { Transform } from 'class-transformer';
import { IsNumberString, Matches } from 'class-validator';

const ISO_CURRENCY = /^[A-Z]{3}$/;

export class ConvertCurrencyDto {
  @IsNumberString()
  amount!: string;

  @Transform(({ value }) => String(value).toUpperCase())
  @Matches(ISO_CURRENCY)
  from!: string;

  @Transform(({ value }) => String(value).toUpperCase())
  @Matches(ISO_CURRENCY)
  to!: string;
}
