import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MenuState } from '@lifehome/contracts';
import { PrismaService } from '../database/prisma.service';
import type {
  MenuPolicy,
  Platform,
  ServiceModuleCode,
} from '../generated/prisma/client';

export type PolicyContext = {
  userId?: string;
  roles?: string[];
  platform?: Platform;
  countryCode?: string;
  regionId?: string;
};

const serviceKey: Record<ServiceModuleCode, string> = {
  REAL_ESTATE: 'realEstate',
  LIFE_CONVENIENCE: 'lifeConvenience',
  ROOMMATE: 'roommate',
  SENIOR: 'senior',
  FUNERAL: 'funeral',
  CHILDCARE: 'childcare',
  PET: 'pet',
  MOVING: 'moving',
  COMMUNITY: 'community',
};

@Injectable()
export class FeaturePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getServiceStates(): Promise<Record<string, MenuState>> {
    const modules = await this.prisma.serviceModule.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { code: true, defaultState: true },
    });
    return Object.fromEntries(
      modules.map((module) => [
        serviceKey[module.code],
        module.defaultState as MenuState,
      ]),
    );
  }

  async getMenuStates(
    context: PolicyContext,
  ): Promise<Record<string, MenuState>> {
    const menus = await this.prisma.menu.findMany({
      where: context.platform ? { platform: context.platform } : undefined,
      select: { code: true },
      orderBy: { sortOrder: 'asc' },
    });
    const resolved = await Promise.all(
      menus.map(async (menu) => [
        menu.code,
        await this.resolveMenuState(menu.code, context),
      ] as const),
    );
    return Object.fromEntries(resolved);
  }

  async resolveMenuState(
    code: string,
    context: PolicyContext,
  ): Promise<MenuState> {
    const now = new Date();
    const roleFilter = context.roles?.length
      ? [{ roleId: null }, { role: { code: { in: context.roles } } }]
      : [{ roleId: null }];
    const menu = await this.prisma.menu.findUnique({
      where: { code },
      include: {
        serviceModule: true,
        policies: {
          where: {
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
            AND: [
              { OR: roleFilter },
              {
                OR: [
                  { platform: null },
                  ...(context.platform
                    ? [{ platform: context.platform }]
                    : []),
                ],
              },
              {
                OR: [
                  { countryCode: null },
                  ...(context.countryCode
                    ? [{ countryCode: context.countryCode }]
                    : []),
                ],
              },
              {
                OR: [
                  { regionId: null },
                  ...(context.regionId
                    ? [{ regionId: context.regionId }]
                    : []),
                ],
              },
            ],
          },
        },
      },
    });
    if (!menu) {
      throw new NotFoundException('메뉴 정책을 찾을 수 없습니다.');
    }
    if (menu.serviceModule.defaultState !== 'ACTIVE') {
      return menu.serviceModule.defaultState as MenuState;
    }
    const selected = [...menu.policies].sort(
      (left, right) => this.policyScore(right) - this.policyScore(left),
    )[0];
    return (selected?.state ?? menu.defaultState) as MenuState;
  }

  assertReadable(state: MenuState): void {
    if (state === MenuState.HIDDEN || state === MenuState.DISABLED) {
      throw new ForbiddenException('현재 이용할 수 없는 기능입니다.');
    }
    if (state === MenuState.MAINTENANCE) {
      throw new ServiceUnavailableException(
        '현재 서비스 점검이 진행 중입니다.',
      );
    }
  }

  assertWritable(state: MenuState): void {
    this.assertReadable(state);
    if (
      state === MenuState.READ_ONLY ||
      state === MenuState.INTAKE_DISABLED
    ) {
      throw new ForbiddenException('현재 신규 요청을 접수할 수 없습니다.');
    }
  }

  private policyScore(policy: MenuPolicy): number {
    const specificity = [
      policy.roleId,
      policy.platform,
      policy.countryCode,
      policy.regionId,
    ].filter(Boolean).length;
    return (
      (policy.isEmergency ? 1_000_000 : 0) +
      specificity * 10_000 +
      policy.priority
    );
  }
}
