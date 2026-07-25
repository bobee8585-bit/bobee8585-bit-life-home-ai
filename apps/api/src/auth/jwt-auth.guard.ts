import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { UserStatus } from '../generated/prisma/client';
import type { AuthenticatedRequest } from './auth.types';
import { AuthTokenService } from './auth-token.service';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AuthTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearerToken(request.headers.authorization);
    const payload = await this.tokens.verifyAccessToken(token);
    const session = await this.prisma.userSession.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: {
          status: {
            in: [UserStatus.PENDING, UserStatus.ACTIVE, UserStatus.RESTRICTED],
          },
        },
      },
      select: { id: true },
    });
    if (!session) {
      throw new UnauthorizedException('인증 세션이 만료되었거나 폐기되었습니다.');
    }

    request.auth = payload;
    return true;
  }

  private bearerToken(authorization: string | undefined): string {
    const [type, token] = authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }
    return token;
  }
}
