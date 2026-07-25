import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthTokens } from '@lifehome/contracts';
import type { AccessTokenPayload } from './auth.types';

const ISSUER = 'life-home-ai';
const AUDIENCE = 'life-home-api';

export function accessTokenSecret(): string {
  const configured = process.env.JWT_ACCESS_SECRET;
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_ACCESS_SECRET is required in production.');
  }
  return 'life-home-local-access-secret-change-before-production';
}

@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(
    user: {
      id: string;
      status: string;
      roles: string[];
    },
    sessionId: string,
    refreshTokenId: string,
  ): Promise<{
    tokens: AuthTokens;
    refreshTokenHash: string;
  }> {
    const accessTtlSeconds = this.accessTtlSeconds();
    const refreshExpiresAt = new Date(
      Date.now() + this.refreshTtlDays() * 24 * 60 * 60 * 1000,
    );
    const refreshSecret = randomBytes(48).toString('base64url');
    const refreshToken = `${refreshTokenId}.${refreshSecret}`;
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        sid: sessionId,
        roles: user.roles,
        status: user.status,
      } satisfies AccessTokenPayload,
      {
        secret: accessTokenSecret(),
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: accessTtlSeconds,
      },
    );

    return {
      tokens: {
        accessToken,
        accessTokenExpiresAt: new Date(
          Date.now() + accessTtlSeconds * 1000,
        ).toISOString(),
        refreshToken,
        refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      },
      refreshTokenHash: this.hashRefreshSecret(refreshSecret),
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: accessTokenSecret(),
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('인증 토큰이 유효하지 않습니다.');
    }
  }

  parseRefreshToken(token: string): {
    tokenId: string;
    secret: string;
  } {
    const separator = token.indexOf('.');
    if (separator < 1 || separator === token.length - 1) {
      throw new UnauthorizedException('Refresh Token이 유효하지 않습니다.');
    }

    return {
      tokenId: token.slice(0, separator),
      secret: token.slice(separator + 1),
    };
  }

  matchesRefreshSecret(secret: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashRefreshSecret(secret), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return (
      actual.length === expected.length &&
      actual.length > 0 &&
      timingSafeEqual(actual, expected)
    );
  }

  private hashRefreshSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private accessTtlSeconds(): number {
    const value = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);
    return Number.isFinite(value) && value >= 60 ? value : 900;
  }

  private refreshTtlDays(): number {
    const value = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
    return Number.isFinite(value) && value >= 1 ? value : 30;
  }
}
