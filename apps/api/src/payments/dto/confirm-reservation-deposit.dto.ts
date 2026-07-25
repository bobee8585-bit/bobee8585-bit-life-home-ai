import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConfirmReservationDepositDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  paymentKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  kcpEncData?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  kcpEncInfo?: string;

  @IsOptional()
  @IsIn(['PACA'])
  kcpPayType?: string;

  @IsNumberString()
  amount!: string;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
