import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BrokerStatus } from '../../generated/prisma/client';

export class ListBrokerRegistrationsDto {
  @IsOptional()
  @IsEnum(BrokerStatus)
  status: BrokerStatus = BrokerStatus.PENDING;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
