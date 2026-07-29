import { IsDateString, IsNumberString } from 'class-validator';

export class UpdatePropertyPriceDto {
  @IsNumberString()
  price!: string;

  @IsDateString()
  expectedUpdatedAt!: string;
}
