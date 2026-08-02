import { IsObject } from 'class-validator';

export class RecordRecentSearchDto {
  @IsObject()
  criteria!: Record<string, unknown>;
}
