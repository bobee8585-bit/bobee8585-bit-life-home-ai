import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { AuthTokenService } from './auth-token.service';

describe('AuthTokenService', () => {
  const service = new AuthTokenService(new JwtService());

  it('issues and verifies access and refresh tokens', async () => {
    const issued = await service.issue(
      {
        id: '019c75df-0255-7000-8000-000000000001',
        status: 'ACTIVE',
        roles: ['GENERAL_USER'],
      },
      '019c75df-0255-7000-8000-000000000002',
      '019c75df-0255-7000-8000-000000000003',
    );

    const payload = await service.verifyAccessToken(
      issued.tokens.accessToken,
    );
    const parsed = service.parseRefreshToken(issued.tokens.refreshToken);

    expect(payload.roles).toEqual(['GENERAL_USER']);
    expect(parsed.tokenId).toBe('019c75df-0255-7000-8000-000000000003');
    expect(
      service.matchesRefreshSecret(
        parsed.secret,
        issued.refreshTokenHash,
      ),
    ).toBe(true);
  });

  it('rejects malformed refresh tokens', () => {
    expect(() => service.parseRefreshToken('invalid')).toThrow();
  });
});
