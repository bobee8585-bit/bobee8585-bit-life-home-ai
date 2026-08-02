import { IsIn, IsOptional } from 'class-validator';

export class PropertyComparisonQueryDto {
  @IsOptional()
  @IsIn(['KRW', 'USD', 'EUR', 'CNY', 'JPY', 'GBP', 'CAD', 'AUD', 'SGD', 'HKD'])
  displayCurrency = 'KRW';
}
