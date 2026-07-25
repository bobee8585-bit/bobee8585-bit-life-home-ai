import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface ProviderRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  provider: string;
  sourceTimestamp: Date;
}

@Injectable()
export class FrankfurterRateProvider {
  readonly name = process.env.EXCHANGE_RATE_PROVIDER ?? 'FRANKFURTER';
  private readonly endpoint =
    process.env.EXCHANGE_RATE_PROVIDER_URL ??
    'https://api.frankfurter.dev/v2/rate/{base}/{quote}';
  private readonly timeoutMs = this.positiveInteger(
    process.env.EXCHANGE_RATE_FETCH_TIMEOUT_MS,
    5_000,
  );

  async latest(baseCurrency: string, quoteCurrency: string): Promise<ProviderRate> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = this.endpoint
        .replace('{base}', encodeURIComponent(baseCurrency))
        .replace('{quote}', encodeURIComponent(quoteCurrency));
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new BadGatewayException(
          `환율 공급자가 HTTP ${response.status}를 반환했습니다.`,
        );
      }
      return this.parse(await response.json(), baseCurrency, quoteCurrency);
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        error instanceof Error && error.name === 'AbortError'
          ? '환율 공급자 응답 시간이 초과되었습니다.'
          : '환율 공급자에 연결할 수 없습니다.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private parse(
    value: unknown,
    requestedBase: string,
    requestedQuote: string,
  ): ProviderRate {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadGatewayException('환율 공급자 응답 형식이 올바르지 않습니다.');
    }
    const row = value as Record<string, unknown>;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadGatewayException('유효한 환율을 받지 못했습니다.');
    }
    const baseCurrency =
      typeof row.base === 'string' ? row.base.toUpperCase() : requestedBase;
    const quoteCurrency =
      typeof row.quote === 'string' ? row.quote.toUpperCase() : requestedQuote;
    if (
      baseCurrency !== requestedBase ||
      quoteCurrency !== requestedQuote
    ) {
      throw new BadGatewayException('요청한 통화쌍과 공급자 응답이 다릅니다.');
    }
    const sourceTimestamp = this.sourceTimestamp(row.date);
    return {
      baseCurrency,
      quoteCurrency,
      rate: rate.toString(),
      provider: this.name,
      sourceTimestamp,
    };
  }

  private sourceTimestamp(value: unknown): Date {
    if (typeof value !== 'string') {
      return new Date();
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadGatewayException('환율 기준 시각이 올바르지 않습니다.');
    }
    return date;
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
