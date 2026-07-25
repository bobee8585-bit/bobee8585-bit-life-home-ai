import { Transform } from 'class-transformer';
import {
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBrokerRegistrationDto {
  @Transform(trim)
  @IsString()
  @Length(2, 50)
  legalName!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9가-힣-]{5,40}$/)
  licenseNumber!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  officeName!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 50)
  representativeName!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\d{10}$/)
  businessRegistrationNumber!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9가-힣-]{5,40}$/)
  brokerageRegistrationNumber!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  phoneCountryCode!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[^\d+]/g, '') : value,
  )
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phoneNumber!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\d{5}$/)
  postalCode!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  addressLine1!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  addressLine2!: string;
}
