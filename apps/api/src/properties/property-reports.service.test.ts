import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { PropertyReportReason } from '../generated/prisma/client';
import { PropertyReportsService } from './property-reports.service';

describe('PropertyReportsService', () => {
  it('prevents a broker from reporting their own listing', async () => {
    const userId = '019c75df-0255-7000-8000-000000000001';
    const prisma = {
      property: {
        findFirst: async () => ({
          id: '019c75df-0255-7000-8000-000000000020',
          brokerUserId: userId,
          listingNumber: 'LH-2026-TEST',
        }),
      },
    } as unknown as PrismaService;
    const service = new PropertyReportsService(prisma);

    await expect(
      service.create(
        userId,
        '019c75df-0255-7000-8000-000000000020',
        {
          reason: PropertyReportReason.FALSE_INFORMATION,
          description: '본인 매물에 대한 신고 시도를 차단하는 테스트입니다.',
          evidenceUrls: [],
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
