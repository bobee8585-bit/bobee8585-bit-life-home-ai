import { IsOptional, IsUUID } from 'class-validator';

export class AddPropertyComparisonDto {
  @IsUUID()
  propertyId!: string;

  @IsOptional()
  @IsUUID()
  replacePropertyId?: string;
}
