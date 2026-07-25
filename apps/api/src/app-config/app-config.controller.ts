import { Controller, Get } from '@nestjs/common';
import type { AppConfig } from '@lifehome/contracts';
import { Public } from '../auth/public.decorator';
import { FeaturePolicyService } from '../feature-policy/feature-policy.service';
import { Platform } from '../generated/prisma/client';
import { SUPPORTED_CURRENCIES } from '../currency/currency.service';

type PaymentConfig = NonNullable<AppConfig['payment']>;
type PaymentProvider = PaymentConfig['provider'];

@Public()
@Controller('app')
export class AppConfigController {
  constructor(private readonly featurePolicy: FeaturePolicyService) {}

  @Get('config')
  async getConfig(): Promise<AppConfig> {
    const paymentProvider = this.paymentProvider();
    return {
      country: 'KR',
      locale: 'ko-KR',
      currency: 'KRW',
      supportedCurrencies: [...SUPPORTED_CURRENCIES],
      exchangeRateUsage: 'DISPLAY_ONLY',
      timezone: 'Asia/Seoul',
      areaUnit: 'SQUARE_METER',
      services: await this.featurePolicy.getServiceStates(),
      menus: await this.featurePolicy.getMenuStates({
        platform: Platform.USER_WEB,
        countryCode: 'KR',
      }),
      payment: {
        provider: paymentProvider,
        clientKey: this.paymentClientKey(paymentProvider),
        siteCode:
          paymentProvider === 'NHN_KCP'
            ? process.env.NHN_KCP_SITE_CODE ?? null
            : null,
        reservationDepositEnabled: true,
      },
      notifications: {
        pushProvider: this.pushProvider(),
        smsProvider: this.smsProvider(),
        pushRegistrationEnabled: true,
      },
      version: 9,
    };
  }

  private pushProvider(): 'LOG' | 'FCM' | 'DISABLED' {
    const value = process.env.PUSH_PROVIDER_MODE?.trim().toUpperCase();
    if (!value) {
      return process.env.NODE_ENV === 'production' ? 'DISABLED' : 'LOG';
    }
    return value === 'FCM' || value === 'LOG' ? value : 'DISABLED';
  }

  private smsProvider(): 'LOG' | 'NAVER_SENS' | 'DISABLED' {
    const value = process.env.SMS_PROVIDER_MODE?.trim().toUpperCase();
    if (!value) {
      return process.env.NODE_ENV === 'production' ? 'DISABLED' : 'LOG';
    }
    return value === 'NAVER_SENS' || value === 'LOG'
      ? value
      : 'DISABLED';
  }

  private paymentProvider(): PaymentProvider {
    const value =
      process.env.PAYMENT_PROVIDER_MODE?.trim().toUpperCase() ?? 'MOCK';
    if (value === 'NICE') {
      return 'NICEPAY';
    }
    if (value === 'KCP') {
      return 'NHN_KCP';
    }
    return ['TOSS', 'NICEPAY', 'NHN_KCP'].includes(value)
      ? (value as 'TOSS' | 'NICEPAY' | 'NHN_KCP')
      : 'MOCK';
  }

  private paymentClientKey(
    provider: PaymentProvider,
  ): string | null {
    if (provider === 'TOSS') {
      return process.env.TOSS_PAYMENTS_CLIENT_KEY ?? null;
    }
    if (provider === 'NICEPAY') {
      return process.env.NICEPAY_CLIENT_KEY ?? null;
    }
    return null;
  }
}
