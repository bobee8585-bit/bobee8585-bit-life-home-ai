import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MenuState } from '@lifehome/contracts';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { FeaturePolicyService } from './feature-policy.service';

describe('FeaturePolicyService', () => {
  const service = new FeaturePolicyService({} as PrismaService);

  it('allows active services to be written', () => {
    expect(() => service.assertWritable(MenuState.ACTIVE)).not.toThrow();
  });

  it('blocks new intake in intake-disabled state', () => {
    expect(() =>
      service.assertWritable(MenuState.INTAKE_DISABLED),
    ).toThrow(ForbiddenException);
  });

  it('returns maintenance errors during maintenance', () => {
    expect(() => service.assertReadable(MenuState.MAINTENANCE)).toThrow(
      ServiceUnavailableException,
    );
  });

  it('selects the most specific active database policy', async () => {
    const prisma = {
      menu: {
        findUnique: async () => ({
          defaultState: 'ACTIVE',
          serviceModule: { defaultState: 'ACTIVE' },
          policies: [
            {
              state: 'READ_ONLY',
              roleId: null,
              platform: null,
              countryCode: null,
              regionId: null,
              isEmergency: false,
              priority: 100,
            },
            {
              state: 'INTAKE_DISABLED',
              roleId: 'broker-role',
              platform: 'API',
              countryCode: null,
              regionId: null,
              isEmergency: false,
              priority: 10,
            },
          ],
        }),
      },
    } as unknown as PrismaService;
    const databaseService = new FeaturePolicyService(prisma);

    await expect(
      databaseService.resolveMenuState('BROKER_REGISTRATION', {
        roles: ['GENERAL_USER'],
      }),
    ).resolves.toBe(MenuState.INTAKE_DISABLED);
  });
});
