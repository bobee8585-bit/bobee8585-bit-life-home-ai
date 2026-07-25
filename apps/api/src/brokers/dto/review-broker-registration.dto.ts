import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class ReviewBrokerRegistrationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 500)
  reason!: string;
}
