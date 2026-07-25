import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  FrankfurterRateProvider,
  type ProviderRate,
} from './frankfurter-rate.provider';

export const SUPPORTED_CURRENCIES = [
  'KRW',
  'USD',
  'EUR',
  'CNY',
  'JPY',
  'GBP',
  'CAD',
  'AUD',
  'SGD',
  'HKD',
] as const;

export interface ExchangeRateView {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  provider: string;
  sourceTimestamp: string;
  fetchedAt: string;
  expiresAt: string;
  isStale: boolean;
}

@Injectable()
export class CurrencyService {
  private readonly cacheTtlMs =
    this.positiveInteger(process.env.EXCHANGE_RATE_CACHE_TTL_SECONDS, 900) *
    1_000;
  private readonly staleTtlMs =
    this.positiveInteger(process.env.EXCHANGE_RATE_STALE_TTL_SECONDS, 604_800) *
    1_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: FrankfurterRateProvider,
  ) {}

  supportedCurrencies(): readonly string[] {
    return SUPPORTED_CURRENCIES;
  }

  async rate(base: string, quote: string): Promise<ExchangeRateView> {
    const baseCurrency = this.currency(base);
    const quoteCurrency = this.currency(quote);
    const now = new Date();
    if (baseCurrency === quoteCurrency) {
      return {
        baseCurrency,
        quoteCurrency,
        rate: '1',
        provider: 'IDENTITY',
        sourceTimestamp: now.toISOString(),
        fetchedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.cacheTtlMs).toISOString(),
        isStale: false,
      };
    }

    const cached = await this.prisma.exchangeRate.findUnique({
      where: {
        baseCurrency_quoteCurrency: { baseCurrency, quoteCurrency },
      },
    });
    if (cached && cached.expiresAt > now) {
      return this.view(cached, false);
    }

    try {
      const latest = await this.provider.latest(baseCurrency, quoteCurrency);
      const saved = await this.save(latest, now);
      return this.view(saved, false);
    } catch (error: unknown) {
      if (
        cached &&
        now.getTime() - cached.fetchedAt.getTime() <= this.staleTtlMs
      ) {
        return this.view(cached, true);
      }
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        '환율을 조회할 수 없고 사용 가능한 캐시도 없습니다.',
      );
    }
  }

  async convert(amount: string, from: string, to: string) {
    const result = await this.convertAmounts({ amount }, from, to);
    return {
      amount,
      convertedAmount: result.amounts.amount,
      fromCurrency: result.exchangeRate.baseCurrency,
      toCurrency: result.exchangeRate.quoteCurrency,
      exchangeRate: result.exchangeRate,
      usage: 'DISPLAY_ONLY' as const,
    };
  }

  async convertAmounts(
    amounts: Record<string, string | null>,
    from: string,
    to: string,
  ) {
    const exchangeRate = await this.rate(from, to);
    const digits = this.fractionDigits(exchangeRate.quoteCurrency);
    const converted: Record<string, string | null> = {};
    for (const [key, amount] of Object.entries(amounts)) {
      converted[key] =
        amount === null
          ? null
          : this.convertAmount(amount, exchangeRate.rate, digits);
    }
    return { amounts: converted, exchangeRate };
  }

  private convertAmount(amount: string, rate: string, digits: number): string {
    let input: Prisma.Decimal;
    try {
      input = new Prisma.Decimal(amount);
    } catch {
      throw new BadRequestException('변환 금액이 올바르지 않습니다.');
    }
    if (input.isNegative()) {
      throw new BadRequestException('변환 금액은 0 이상이어야 합니다.');
    }
    return input
      .mul(rate)
      .toDecimalPlaces(digits)
      .toFixed(digits);
  }

  private async save(rate: ProviderRate, fetchedAt: Date) {
    return this.prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency: {
          baseCurrency: rate.baseCurrency,
          quoteCurrency: rate.quoteCurrency,
        },
      },
      create: {
        id: createId(),
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: rate.rate,
        provider: rate.provider,
        sourceTimestamp: rate.sourceTimestamp,
        fetchedAt,
        expiresAt: new Date(fetchedAt.getTime() + this.cacheTtlMs),
      },
      update: {
        rate: rate.rate,
        provider: rate.provider,
        sourceTimestamp: rate.sourceTimestamp,
        fetchedAt,
        expiresAt: new Date(fetchedAt.getTime() + this.cacheTtlMs),
      },
    });
  }

  private view(
    rate: {
      baseCurrency: string;
      quoteCurrency: string;
      rate: { toString(): string };
      provider: string;
      sourceTimestamp: Date;
      fetchedAt: Date;
      expiresAt: Date;
    },
    isStale: boolean,
  ): ExchangeRateView {
    return {
      baseCurrency: rate.baseCurrency,
      quoteCurrency: rate.quoteCurrency,
      rate: rate.rate.toString(),
      provider: rate.provider,
      sourceTimestamp: rate.sourceTimestamp.toISOString(),
      fetchedAt: rate.fetchedAt.toISOString(),
      expiresAt: rate.expiresAt.toISOString(),
      isStale,
    };
  }

  private currency(value: string): string {
    const code = value.trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(code as (typeof SUPPORTED_CURRENCIES)[number])) {
      throw new BadRequestException(`지원하지 않는 통화입니다: ${code}`);
    }
    return code;
  }

  private fractionDigits(currency: string): number {
    return currency === 'KRW' || currency === 'JPY' ? 0 : 2;
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
