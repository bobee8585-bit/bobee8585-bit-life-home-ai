import { IsString, IsUUID, Length } from 'class-validator';

export class ConfirmVerificationDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
