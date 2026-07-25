import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type {
  AuthenticatedUser,
  AuthResult,
} from '@lifehome/contracts';
import type { Request } from 'express';
import { Platform } from '../generated/prisma/client';
import type {
  AuthenticatedRequest,
  ClientContext,
} from './auth.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { ConfirmVerificationDto } from './dto/confirm-verification.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RequestPhoneVerificationDto } from './dto/request-phone-verification.dto';
import { Public } from './public.decorator';
import type { ChallengeReceipt } from './verification.service';
import { VerificationService } from './verification.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: VerificationService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ): Promise<AuthResult> {
    return this.auth.register(dto, this.clientContext(request));
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<AuthResult> {
    return this.auth.login(dto, this.clientContext(request));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<AuthResult> {
    return this.auth.refresh(
      dto.refreshToken,
      this.clientContext(request),
    );
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ loggedOut: true }> {
    await this.auth.logout(request.auth.sub, request.auth.sid);
    return { loggedOut: true };
  }

  @Get('me')
  async me(
    @Req() request: AuthenticatedRequest,
  ): Promise<AuthenticatedUser> {
    return this.auth.me(request.auth.sub);
  }

  @Post('verification/email/request')
  async requestEmailVerification(
    @Req() request: AuthenticatedRequest,
  ): Promise<ChallengeReceipt> {
    return this.verification.requestEmailVerification(request.auth.sub);
  }

  @HttpCode(200)
  @Post('verification/email/confirm')
  async confirmEmailVerification(
    @Body() dto: ConfirmVerificationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ verified: true }> {
    return this.verification.confirmEmail(
      request.auth.sub,
      dto.challengeId,
      dto.code,
    );
  }

  @Post('verification/phone/request')
  async requestPhoneVerification(
    @Body() dto: RequestPhoneVerificationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ChallengeReceipt> {
    return this.verification.requestPhoneVerification(
      request.auth.sub,
      dto.countryCode,
      dto.phoneNumber,
    );
  }

  @HttpCode(200)
  @Post('verification/phone/confirm')
  async confirmPhoneVerification(
    @Body() dto: ConfirmVerificationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ verified: true }> {
    return this.verification.confirmPhone(
      request.auth.sub,
      dto.challengeId,
      dto.code,
    );
  }

  @Public()
  @HttpCode(202)
  @Post('password-reset/request')
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<ChallengeReceipt> {
    return this.verification.requestPasswordReset(dto.email);
  }

  @Public()
  @HttpCode(200)
  @Post('password-reset/confirm')
  async confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
  ): Promise<{ reset: true }> {
    return this.verification.confirmPasswordReset(
      dto.challengeId,
      dto.code,
      dto.newPassword,
    );
  }

  private clientContext(request: Request): ClientContext {
    const requestedPlatform = request.header('x-platform');
    const platform = Object.values(Platform).find(
      (value) => value === requestedPlatform,
    );

    return {
      platform,
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    };
  }
}
