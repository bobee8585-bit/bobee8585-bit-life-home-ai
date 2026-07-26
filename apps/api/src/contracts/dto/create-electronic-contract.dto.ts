import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ElectronicContractProvider } from '../../generated/prisma/client';

class ContractTermsConsentDto {
  @IsBoolean()
  personalDataProvision!: boolean;

  @IsBoolean()
  electronicSignature!: boolean;

  @IsBoolean()
  providerTerms!: boolean;
}

export class CreateElectronicContractDto {
  @IsEnum(ElectronicContractProvider)
  provider!: ElectronicContractProvider;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  termsVersion!: string;

  @ValidateNested()
  @Type(() => ContractTermsConsentDto)
  consent!: ContractTermsConsentDto;
}
