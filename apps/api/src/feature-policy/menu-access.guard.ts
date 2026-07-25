import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../auth/auth.types';
import { PrismaService } from '../database/prisma.service';
import { Platform } from '../generated/prisma/client';
import {
  MENU_ACCESS_KEY,
  type MenuAccessRequirement,
} from './menu-access.decorator';
import { FeaturePolicyService } from './feature-policy.service';

@Injectable()
export class MenuAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policies: FeaturePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement =
      this.reflector.getAllAndOverride<MenuAccessRequirement>(
        MENU_ACCESS_KEY,
        [context.getHandler(), context.getClass()],
      );
    if (!requirement) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { auth?: AccessTokenPayload }>();
    const requestedPlatform = request.header('x-platform');
    const platform = Object.values(Platform).find(
      (value) => value === requestedPlatform,
    );
    const now = new Date();
    const user = request.auth
      ? await this.prisma.user.findUnique({
          where: { id: request.auth.sub },
          select: {
            profile: {
              select: { countryCode: true, regionId: true },
            },
            roles: {
              where: {
                startsAt: { lte: now },
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              select: { role: { select: { code: true } } },
            },
          },
        })
      : null;
    const state = await this.policies.resolveMenuState(requirement.code, {
      userId: request.auth?.sub,
      roles: user?.roles.map((entry) => entry.role.code) ?? [],
      platform: platform ?? Platform.API,
      countryCode: user?.profile?.countryCode,
      regionId: user?.profile?.regionId ?? undefined,
    });
    if (requirement.mode === 'write') {
      this.policies.assertWritable(state);
    } else {
      this.policies.assertReadable(state);
    }
    return true;
  }
}
