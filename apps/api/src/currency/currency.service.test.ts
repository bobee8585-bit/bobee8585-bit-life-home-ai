import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { CurrencyService } from './currency.service';
import type { FrankfurterRateProvider } from './frankfurter-rate.provider';

const cachedRate = (overrides: Record<string, unknown> = {}) => ({
  id: '019c75df-0255-7000-8000-000000000090',
  baseCurrency: 'KRW',
  quoteCurrency: 'USD',
  rate: new Prisma.Decimal('0.00073'),
  provider: 'FRANKFURTER',
  sourceTimestamp: new Date('2026-07-24T00:00:00.000Z'),
  fetchedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('CurrencyService', () => {
  it('uses an unexpired database cache without calling the provider', async () => {
    const provider = {
      latest: vi.fn(),
    } as unknown as FrankfurterRateProvider;
    const prisma = {
      exchangeRate: {
        findUnique: vi.fn(async () => cachedRate()),
      },
    } as unknown as PrismaService;
    const result = await new CurrencyService(prisma, provider).rate(
      'krw',
      'usd',
    );

    expect(result.rate).toBe('0.00073');
    expect(result.isStale).toBe(false);
    expect(provider.latest).not.toHaveBeenCalled();
  });

  it('falls back to a recent stale rate when the provider fails', async () => {
    const provider = {
      latest: vi.fn(async () => {
        throw new ServiceUnavailableException();
      }),
    } as unknown as FrankfurterRateProvider;
    const prisma = {
      exchangeRate: {
        findUnique: vi.fn(async () =>
          cachedRate({
            fetchedAt: new Date(Date.now() - 60 * 60 * 1_000),
            expiresAt: new Date(Date.now() - 1_000),
          }),
        ),
      },
    } as unknown as PrismaService;
    const result = await new CurrencyService(prisma, provider).rate(
      'KRW',
      'USD',
    );

    expect(result.isStale).toBe(true);
    expect(result.rate).toBe('0.00073');
  });

  it('converts multiple property amounts with one identity rate', async () => {
    const service = new CurrencyService(
      {} as PrismaService,
      {} as FrankfurterRateProvider,
    );
    const result = await service.convertAmounts(
      {
        price: '900000000.40',
        deposit: null,
        monthlyRent: '750000.50',
      },
      'KRW',
      'KRW',
    );

    expect(result.amounts).toEqual({
      price: '900000000',
      deposit: null,
      monthlyRent: '750001',
    });
    expect(result.exchangeRate.provider).toBe('IDENTITY');
  });
});
