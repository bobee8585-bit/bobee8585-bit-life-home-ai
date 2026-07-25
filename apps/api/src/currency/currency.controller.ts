import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CurrencyService } from './currency.service';
import { ConvertCurrencyDto } from './dto/convert-currency.dto';
import { RatePairDto } from './dto/rate-pair.dto';

@Public()
@Controller()
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @Get('currencies')
  supported() {
    return {
      currencies: this.currency.supportedCurrencies(),
      defaultCurrency: 'KRW',
      usage: 'DISPLAY_ONLY',
    };
  }

  @Get('exchange-rates/:base/:quote')
  rate(@Param() pair: RatePairDto) {
    return this.currency.rate(pair.base, pair.quote);
  }

  @Get('currency/convert')
  convert(@Query() query: ConvertCurrencyDto) {
    return this.currency.convert(query.amount, query.from, query.to);
  }
}
