import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  OwnershipClaimType,
  PropertyListingType,
  PropertyMediaType,
  PropertyTransactionType,
  PropertyType,
} from '../generated/prisma/client';
import type { CreatePropertyDto } from './dto/create-property.dto';
import { PropertiesService } from './properties.service';
import type { CurrencyService } from '../currency/currency.service';
import type { SensitiveDataService } from '../common/sensitive-data.service';

const baseProperty = (): CreatePropertyDto => ({
  title: '서울 도심 테스트 아파트',
  description: '교통과 생활 편의시설이 가까운 검수용 테스트 매물입니다.',
  propertyType: PropertyType.APARTMENT,
  transactionType: PropertyTransactionType.SALE,
  price: '900000000',
  currency: 'KRW',
  exclusiveArea: '84.50',
  rooms: 3,
  bathrooms: 2,
  countryCode: 'KR',
  region1: '서울특별시',
  city: '서울',
  addressLine1: '서울특별시 중구 테스트로 1',
  media: [],
});

describe('PropertiesService', () => {
  const prisma = {
    brokerProfile: {
      findFirst: async () => ({
        brokerageOfficeId: '019c75df-0255-7000-8000-000000000010',
      }),
    },
  } as unknown as PrismaService;
  const currency = {} as CurrencyService;
  const sensitiveData = {
    encrypt: (value: string) => `encrypted:${value}`,
    decrypt: (value: string) => value.replace('encrypted:', ''),
    hash: (value: string) => `hash:${value}`,
  } as SensitiveDataService;
  const service = new PropertiesService(prisma, currency, sensitiveData);

  it('rejects more than ten public images', async () => {
    const dto = baseProperty();
    dto.media = Array.from({ length: 11 }, (_, index) => ({
      type: PropertyMediaType.IMAGE,
      url: `https://example.com/${index}.jpg`,
      sortOrder: index,
      isPublic: true,
    }));

    await expect(
      service.create('019c75df-0255-7000-8000-000000000001', dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires a positive monthly rent for monthly listings', async () => {
    const dto = baseProperty();
    dto.transactionType = PropertyTransactionType.MONTHLY_RENT;
    dto.price = '10000000';
    dto.monthlyRent = '0';

    await expect(
      service.create('019c75df-0255-7000-8000-000000000001', dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires phone verification for owner-direct listings', async () => {
    const ownerPrisma = {
      user: {
        findUnique: async () => ({ phoneVerifiedAt: null }),
      },
    } as unknown as PrismaService;
    const ownerService = new PropertiesService(
      ownerPrisma,
      currency,
      sensitiveData,
    );
    const dto = baseProperty();
    dto.listingType = PropertyListingType.OWNER_DIRECT;
    dto.ownershipVerification = {
      claimType: OwnershipClaimType.REGISTERED_OWNER,
      evidenceReference: 'secure-upload-reference-001',
      ownershipDeclarationAccepted: true,
      noBrokerageDeclarationAccepted: true,
    };

    await expect(
      ownerService.create(
        '019c75df-0255-7000-8000-000000000001',
        dto,
      ),
    ).rejects.toThrow('휴대폰 본인인증');
  });

  it('requires ownership evidence for owner-direct listings', async () => {
    const ownerPrisma = {
      user: {
        findUnique: async () => ({ phoneVerifiedAt: new Date() }),
      },
    } as unknown as PrismaService;
    const ownerService = new PropertiesService(
      ownerPrisma,
      currency,
      sensitiveData,
    );
    const dto = baseProperty();
    dto.listingType = PropertyListingType.OWNER_DIRECT;

    await expect(
      ownerService.create(
        '019c75df-0255-7000-8000-000000000001',
        dto,
      ),
    ).rejects.toThrow('소유자 또는 적법한 위임자 증빙');
  });
});
