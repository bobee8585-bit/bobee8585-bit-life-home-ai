import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedRequest } from './auth.types';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const now = new Date();
    const rows = await this.prisma.rolePermission.findMany({
      where: {
        role: {
          users: {
            some: {
              userId: request.auth.sub,
              startsAt: { lte: now },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        },
        permission: { code: { in: required } },
      },
      select: { permission: { select: { code: true } } },
    });
    const granted = new Set(rows.map((row) => row.permission.code));
    if (!required.every((permission) => granted.has(permission))) {
      throw new ForbiddenException('이 기능을 사용할 세부 권한이 없습니다.');
    }
    return true;
  }
}
