import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService, accessTokenSecret } from './auth-token.service';
import { PasswordHasherService } from './password-hasher.service';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { VerificationDeliveryService } from './verification-delivery.service';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    JwtModule.register({
      secret: accessTokenSecret(),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokenService,
    PasswordHasherService,
    SensitiveDataService,
    VerificationDeliveryService,
    VerificationService,
  ],
  exports: [AuthTokenService, SensitiveDataService],
})
export class AuthModule {}
