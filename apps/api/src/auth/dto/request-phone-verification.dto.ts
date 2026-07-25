import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class RequestPhoneVerificationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  countryCode!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[^\d+]/g, '') : value,
  )
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phoneNumber!: string;
}
