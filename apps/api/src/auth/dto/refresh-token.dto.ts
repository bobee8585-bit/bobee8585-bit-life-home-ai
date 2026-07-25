import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MinLength(50)
  @MaxLength(500)
  refreshToken!: string;
}
