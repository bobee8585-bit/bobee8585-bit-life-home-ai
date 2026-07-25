import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class UploadPropertyMediaDto {
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true',
  )
  @IsBoolean()
  isPublic!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder!: number;
}
