import { Module } from '@nestjs/common';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { FrankfurterRateProvider } from './frankfurter-rate.provider';

@Module({
  controllers: [CurrencyController],
  providers: [CurrencyService, FrankfurterRateProvider],
  exports: [CurrencyService],
})
export class CurrencyModule {}
