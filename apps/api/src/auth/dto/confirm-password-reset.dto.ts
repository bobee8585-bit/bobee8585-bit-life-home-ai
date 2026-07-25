import { IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';

export class ConfirmPasswordResetDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword!: string;
}
