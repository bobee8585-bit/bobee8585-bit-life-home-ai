import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { createId } from '../common/id';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { PrismaService } from '../database/prisma.service';
import {
  VerificationChannel,
  VerificationPurpose,
} from '../generated/prisma/client';
import { PasswordHasherService } from './password-hasher.service';
import { VerificationDeliveryService } from './verification-delivery.service';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

export type ChallengeReceipt = {
  challengeId: string;
  expiresAt: string;
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sensitiveData: SensitiveDataService,
    private readonly delivery: VerificationDeliveryService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  async requestEmailVerification(userId: string): Promise<ChallengeReceipt> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (!user?.email) {
      throw new NotFoundException('인증할 이메일이 없습니다.');
    }
    if (user.emailVerifiedAt) {
      throw new ConflictException('이미 인증된 이메일입니다.');
    }
    return this.issue(
      user.id,
      VerificationChannel.EMAIL,
      VerificationPurpose.EMAIL_VERIFY,
      user.email,
    );
  }

  async requestPhoneVerification(
    userId: string,
    countryCode: string,
    phoneNumber: string,
  ): Promise<ChallengeReceipt> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('회원을 찾을 수 없습니다.');
    }
    const normalized = this.normalizePhone(countryCode, phoneNumber);
    const phoneHash = this.sensitiveData.hash(normalized);
    const duplicate = await this.prisma.user.findFirst({
      where: { phoneHash, id: { not: userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('이미 사용 중인 휴대폰 번호입니다.');
    }
    return this.issue(
      userId,
      VerificationChannel.SMS,
      VerificationPurpose.PHONE_VERIFY,
      normalized,
    );
  }

  async confirmEmail(
    userId: string,
    challengeId: string,
    code: string,
  ): Promise<{ verified: true }> {
    await this.consume(
      challengeId,
      code,
      VerificationPurpose.EMAIL_VERIFY,
      userId,
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    return { verified: true };
  }

  async confirmPhone(
    userId: string,
    challengeId: string,
    code: string,
  ): Promise<{ verified: true }> {
    const challenge = await this.consume(
      challengeId,
      code,
      VerificationPurpose.PHONE_VERIFY,
      userId,
    );
    const destination = challenge.destination;
    const separator = destination.indexOf(':');
    const countryCode = destination.slice(0, separator);
    const phoneNumber = destination.slice(separator + 1);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneCountryCode: countryCode,
        phoneNumberEncrypted: this.sensitiveData.encrypt(phoneNumber),
        phoneHash: this.sensitiveData.hash(destination),
        phoneVerifiedAt: new Date(),
      },
    });
    return { verified: true };
  }

  async requestPasswordReset(email: string): Promise<ChallengeReceipt> {
    const opaqueId = createId();
    const expiresAt = this.expiresAt();
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user?.email) {
      return {
        challengeId: opaqueId,
        expiresAt: expiresAt.toISOString(),
      };
    }
    return this.issue(
      user.id,
      VerificationChannel.EMAIL,
      VerificationPurpose.PASSWORD_RESET,
      user.email,
    );
  }

  async confirmPasswordReset(
    challengeId: string,
    code: string,
    newPassword: string,
  ): Promise<{ reset: true }> {
    const challenge = await this.consume(
      challengeId,
      code,
      VerificationPurpose.PASSWORD_RESET,
    );
    if (!challenge.userId) {
      throw new BadRequestException('인증 요청이 유효하지 않습니다.');
    }
    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: challenge.userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: challenge.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { reset: true };
  }

  private async issue(
    userId: string,
    channel: VerificationChannel,
    purpose: VerificationPurpose,
    destination: string,
  ): Promise<ChallengeReceipt> {
    const destinationHash = this.sensitiveData.hash(destination);
    const latest = await this.prisma.verificationChallenge.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() <
        RESEND_COOLDOWN_SECONDS * 1000
    ) {
      throw new HttpException(
        '인증 코드는 1분 후 다시 요청할 수 있습니다.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const challengeId = createId();
    const code = this.code();
    const expiresAt = this.expiresAt();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.verificationChallenge.updateMany({
        where: {
          userId,
          purpose,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      await transaction.verificationChallenge.create({
        data: {
          id: challengeId,
          userId,
          channel,
          purpose,
          destinationHash,
          destinationEncrypted: this.sensitiveData.encrypt(destination),
          secretHash: this.sensitiveData.hash(`${challengeId}:${code}`),
          expiresAt,
        },
      });
    });
    try {
      await this.delivery.send({
        channel,
        destination,
        code,
        purpose,
        expiresAt,
      });
    } catch (error: unknown) {
      await this.prisma.verificationChallenge.update({
        where: { id: challengeId },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    return {
      challengeId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async consume(
    challengeId: string,
    code: string,
    purpose: VerificationPurpose,
    userId?: string,
  ): Promise<{ userId: string | null; destination: string }> {
    const challenge = await this.prisma.verificationChallenge.findFirst({
      where: {
        id: challengeId,
        purpose,
        ...(userId ? { userId } : {}),
      },
    });
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.attempts >= MAX_ATTEMPTS
    ) {
      throw new BadRequestException('인증 요청이 만료되었거나 유효하지 않습니다.');
    }

    const expected = Buffer.from(challenge.secretHash, 'hex');
    const actual = Buffer.from(
      this.sensitiveData.hash(`${challengeId}:${code}`),
      'hex',
    );
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      await this.prisma.verificationChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('인증 코드가 올바르지 않습니다.');
    }

    const consumed = await this.prisma.verificationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        attempts: { lt: MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException('이미 사용된 인증 코드입니다.');
    }

    return {
      userId: challenge.userId,
      destination: this.sensitiveData.decrypt(challenge.destinationEncrypted),
    };
  }

  private normalizePhone(countryCode: string, phoneNumber: string): string {
    return `${countryCode.trim().toUpperCase()}:${phoneNumber.replace(/[^\d+]/g, '')}`;
  }

  private code(): string {
    if (process.env.NODE_ENV === 'test' && process.env.VERIFICATION_TEST_CODE) {
      return process.env.VERIFICATION_TEST_CODE;
    }
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private expiresAt(): Date {
    return new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  }
}
