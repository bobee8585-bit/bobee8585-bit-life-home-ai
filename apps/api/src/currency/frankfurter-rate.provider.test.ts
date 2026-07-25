import { BadGatewayException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrankfurterRateProvider } from './frankfurter-rate.provider';

describe('FrankfurterRateProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a current single-pair response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          date: '2026-07-24',
          base: 'KRW',
          quote: 'USD',
          rate: 0.00073,
        }),
      })),
    );
    const result = await new FrankfurterRateProvider().latest('KRW', 'USD');

    expect(result).toMatchObject({
      baseCurrency: 'KRW',
      quoteCurrency: 'USD',
      rate: '0.00073',
      provider: 'FRANKFURTER',
    });
    expect(result.sourceTimestamp.toISOString()).toBe(
      '2026-07-24T00:00:00.000Z',
    );
  });

  it('rejects a response for a different currency pair', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          date: '2026-07-24',
          base: 'EUR',
          quote: 'USD',
          rate: 1.1,
        }),
      })),
    );

    await expect(
      new FrankfurterRateProvider().latest('KRW', 'USD'),
    ).rejects.toThrow(BadGatewayException);
  });
});
