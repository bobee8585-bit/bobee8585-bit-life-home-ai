import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { GuaranteeEligibility } from '../../generated/prisma/client';

export enum RegistryRiskCode {
  MORTGAGE = 'MORTGAGE',
  SEIZURE = 'SEIZURE',
  PROVISIONAL_SEIZURE = 'PROVISIONAL_SEIZURE',
  AUCTION = 'AUCTION',
  TRUST = 'TRUST',
  LEASEHOLD = 'LEASEHOLD',
  OTHER = 'OTHER',
}

export class CreateLeaseSafetyAssessmentDto {
  @IsOptional()
  @IsNumberString()
  estimatedMarketValue?: string;

  @IsOptional()
  @IsNumberString()
  seniorClaimAmount?: string;

  @IsOptional()
  @IsBoolean()
  ownerMatched?: boolean;

  @IsEnum(GuaranteeEligibility)
  guaranteeEligibility!: GuaranteeEligibility;

  @IsArray()
  @ArrayMaxSize(20)
  @IsEnum(RegistryRiskCode, { each: true })
  registryRiskCodes!: RegistryRiskCode[];

  @IsOptional()
  @IsISO8601({ strict: true })
  registryIssuedAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  valuationAssessedAt?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  registrySource?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  valuationSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidenceReference?: string;
}
