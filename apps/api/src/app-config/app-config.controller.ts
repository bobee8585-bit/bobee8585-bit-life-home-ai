import { Controller, Get } from '@nestjs/common';
import {
  ElectronicContractProvider as ContractProviderContract,
  type AppConfig,
} from '@lifehome/contracts';
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
      media: {
        uploadMode: 'ASYNC',
        statusPollingSeconds: 2,
        imageLimit: 20,
        publicImageLimit: 10,
        videoLimit: 3,
        publicVideoLimit: 1,
      },
      chat: {
        transport: 'REST_POLLING',
        textOnly: true,
        messageMaxLength: 2000,
        clientMessageIdRequired: true,
        propertyRegistrantOnly: true,
      },
      electronicContract: {
        enabled: this.contractMode() !== 'DISABLED',
        mode: this.contractMode(),
        providers: this.contractProviders(),
        externalSignatureAndIdentityVerification: true,
        retentionYears: 10,
      },
      routePlanning: {
        provider: this.mapRouteProvider(),
        trafficAwareDrive:
          this.mapRouteProvider() === 'GOOGLE_ROUTES',
        localEstimateFallback: true,
        maxProperties: 5,
      },
      leaseSafety: {
        enabled: true,
        calculationVersion: 'LEASE_SAFETY_V1',
        registryFreshDays: 7,
        valuationFreshDays: 30,
        contractRecheckRequired: true,
        contractRecheck: {
          mode: this.propertySafetyMode(),
          validityMinutes: 30,
          registryMaxAgeHours: 24,
          failClosed: true,
        },
        informationalOnly: true,
      },
      savedPropertySearches: {
        enabled: true,
        maxPerUser: 20,
        newListingAlerts: true,
        pushOnly: true,
      },
      version: 16,
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

  private contractMode(): 'MOCK' | 'GATEWAY' | 'DISABLED' {
    const value =
      process.env.CONTRACT_PROVIDER_MODE?.trim().toUpperCase() ?? 'MOCK';
    if (value === 'GATEWAY') {
      return 'GATEWAY';
    }
    if (value === 'MOCK' && process.env.NODE_ENV !== 'production') {
      return 'MOCK';
    }
    return 'DISABLED';
  }

  private contractProviders(): ContractProviderContract[] {
    if (this.contractMode() === 'DISABLED') {
      return [];
    }
    const supported = new Set(Object.values(ContractProviderContract));
    return (
      process.env.CONTRACT_ENABLED_PROVIDERS ??
      'MODOOSIGN,EFORM_SIGN,GOVERNMENT'
    )
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value): value is ContractProviderContract =>
        supported.has(value as ContractProviderContract),
      );
  }

  private propertySafetyMode(): 'MOCK' | 'GATEWAY' | 'DISABLED' {
    const value =
      process.env.PROPERTY_SAFETY_PROVIDER_MODE?.trim().toUpperCase() ??
      'MOCK';
    if (value === 'GATEWAY') {
      return 'GATEWAY';
    }
    if (value === 'MOCK' && process.env.NODE_ENV !== 'production') {
      return 'MOCK';
    }
    return 'DISABLED';
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

  private mapRouteProvider(): 'GOOGLE_ROUTES' | 'DISABLED' {
    return process.env.MAP_ROUTE_PROVIDER?.trim().toUpperCase() ===
      'GOOGLE_ROUTES'
      ? 'GOOGLE_ROUTES'
      : 'DISABLED';
  }
}
