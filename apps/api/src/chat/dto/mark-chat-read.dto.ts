import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class MarkChatReadDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  throughSequence!: number;
}
