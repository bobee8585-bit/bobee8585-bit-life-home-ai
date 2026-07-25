import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AuthenticatedUser,
  AuthResult,
} from '@lifehome/contracts';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import { UserStatus } from '../generated/prisma/client';
import type { ClientContext } from './auth.types';
import { AuthTokenService } from './auth-token.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PasswordHasherService } from './password-hasher.service';

type UserForAuth = {
  id: string;
  memberNumber: string;
  email: string | null;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  passwordHash: string | null;
  profile: { displayName: string } | null;
  roles: Array<{ role: { code: string } }>;
};

const blockedStatuses = new Set<UserStatus>([
  UserStatus.SUSPENDED,
  UserStatus.DORMANT,
  UserStatus.WITHDRAWN,
  UserStatus.BANNED,
]);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokens: AuthTokenService,
  ) {}

  async register(dto: RegisterDto, context: ClientContext): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    const generalRole = await this.prisma.role.findUnique({
      where: { code: 'GENERAL_USER' },
    });
    if (!generalRole) {
      throw new ServiceUnavailableException(
        '회원 역할 초기화가 완료되지 않았습니다.',
      );
    }

    const passwordHash = await this.passwordHasher.hash(dto.password);
    const userId = createId();

    let user: UserForAuth;
    try {
      user = await this.prisma.$transaction(async (transaction) => {
        return transaction.user.create({
          data: {
            id: userId,
            memberNumber: this.memberNumber(userId),
            email,
            passwordHash,
            profile: {
              create: {
                displayName: dto.displayName.trim(),
                preferredLanguage: dto.locale ?? 'ko-KR',
                timezone: dto.timezone ?? 'Asia/Seoul',
                countryCode: dto.countryCode?.toUpperCase() ?? 'KR',
              },
            },
            roles: {
              create: {
                roleId: generalRole.id,
              },
            },
          },
          include: {
            profile: true,
            roles: {
              include: {
                role: true,
              },
            },
          },
        });
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('이미 가입된 이메일입니다.');
      }
      throw error;
    }

    return this.createSessionResult(user, context);
  }

  async login(dto: LoginDto, context: ClientContext): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(
        '로그인 시도가 제한되었습니다. 잠시 후 다시 시도해주세요.',
      );
    }
    if (blockedStatuses.has(user.status)) {
      throw new UnauthorizedException('현재 로그인할 수 없는 계정입니다.');
    }

    const validPassword = await this.passwordHasher.verify(
      dto.password,
      user.passwordHash,
    );
    if (!validPassword) {
      await this.recordFailedLogin(user.id, user.failedLoginCount);
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    return this.createSessionResult(user, context);
  }

  async refresh(
    refreshToken: string,
    context: ClientContext,
  ): Promise<AuthResult> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    const storedToken = await this.prisma.sessionRefreshToken.findUnique({
      where: { id: parsed.tokenId },
      include: {
        session: {
          include: {
            user: {
              include: {
                profile: true,
                roles: {
                  include: {
                    role: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt.getTime() <= Date.now() ||
      storedToken.session.revokedAt ||
      storedToken.session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Refresh Token이 만료되었거나 폐기되었습니다.');
    }
    if (storedToken.usedAt) {
      await this.revokeSession(storedToken.sessionId);
      throw new UnauthorizedException(
        'Refresh Token 재사용이 감지되어 세션을 종료했습니다.',
      );
    }
    if (
      !this.tokens.matchesRefreshSecret(
        parsed.secret,
        storedToken.tokenHash,
      )
    ) {
      throw new UnauthorizedException('Refresh Token이 유효하지 않습니다.');
    }
    if (blockedStatuses.has(storedToken.session.user.status)) {
      await this.revokeSession(storedToken.sessionId);
      throw new UnauthorizedException('현재 로그인할 수 없는 계정입니다.');
    }

    const nextRefreshTokenId = createId();
    const issued = await this.tokens.issue(
      {
        id: storedToken.session.user.id,
        status: storedToken.session.user.status,
        roles: this.roleCodes(storedToken.session.user),
      },
      storedToken.sessionId,
      nextRefreshTokenId,
    );
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.sessionRefreshToken.updateMany({
        where: {
          id: storedToken.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException('이미 사용된 Refresh Token입니다.');
      }

      await transaction.sessionRefreshToken.create({
        data: {
          id: nextRefreshTokenId,
          sessionId: storedToken.sessionId,
          tokenHash: issued.refreshTokenHash,
          expiresAt: new Date(issued.tokens.refreshTokenExpiresAt),
        },
      });
      await transaction.userSession.update({
        where: { id: storedToken.sessionId },
        data: {
          expiresAt: new Date(issued.tokens.refreshTokenExpiresAt),
          lastUsedAt: new Date(),
          platform: context.platform ?? storedToken.session.platform,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
    });

    return {
      user: this.toAuthenticatedUser(storedToken.session.user),
      tokens: issued.tokens,
    };
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.userSession.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
      await transaction.sessionRefreshToken.updateMany({
        where: {
          sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });
  }

  async me(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException('회원 정보를 확인할 수 없습니다.');
    }
    return this.toAuthenticatedUser(user);
  }

  private async createSessionResult(
    user: UserForAuth,
    context: ClientContext,
  ): Promise<AuthResult> {
    const sessionId = createId();
    const refreshTokenId = createId();
    const issued = await this.tokens.issue(
      {
        id: user.id,
        status: user.status,
        roles: this.roleCodes(user),
      },
      sessionId,
      refreshTokenId,
    );

    await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        platform: context.platform,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt: new Date(issued.tokens.refreshTokenExpiresAt),
        refreshTokens: {
          create: {
            id: refreshTokenId,
            tokenHash: issued.refreshTokenHash,
            expiresAt: new Date(issued.tokens.refreshTokenExpiresAt),
          },
        },
      },
    });

    return {
      user: this.toAuthenticatedUser(user),
      tokens: issued.tokens,
    };
  }

  private toAuthenticatedUser(user: UserForAuth): AuthenticatedUser {
    return {
      id: user.id,
      memberNumber: user.memberNumber,
      email: user.email,
      displayName: user.profile?.displayName ?? '사용자',
      status: user.status,
      roles: this.roleCodes(user),
    };
  }

  private roleCodes(user: UserForAuth): string[] {
    return user.roles.map(({ role }) => role.code);
  }

  private memberNumber(userId: string): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `LH-${date}-${userId.replaceAll('-', '').slice(-8).toUpperCase()}`;
  }

  private async recordFailedLogin(
    userId: string,
    currentFailures: number,
  ): Promise<void> {
    const nextFailures = currentFailures + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: nextFailures,
        lockedUntil:
          nextFailures >= 5
            ? new Date(Date.now() + 15 * 60 * 1000)
            : undefined,
      },
    });
  }

  private async revokeSession(sessionId: string): Promise<void> {
    const revokedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt },
      });
      await transaction.sessionRefreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt },
      });
    });
  }
}
