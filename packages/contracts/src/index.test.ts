import { describe, expect, it } from 'vitest';
import {
  type AppConfig,
  ContractSafetyRecheckStatus,
  type ExchangeRate,
  MenuState,
  PropertyReportStatus,
  PropertyStatus,
  VisitReservationStatus,
  ReservationDepositStatus,
  NotificationDeliveryStatus,
  MediaUploadStatus,
  PropertyListingType,
  PropertyDealStatus,
  VisitTravelMode,
  ChatMessageType,
  ElectronicContractProvider,
  ElectronicContractStatus,
  LeaseSafetyGrade,
  GuaranteeEligibility,
} from './index';

describe('Discovery configuration', () => {
  it('keeps comparison and calendar privacy limits explicit', () => {
    const config = { propertyComparison: { enabled: true, maxItems: 5, commonCurrency: true, detailedLocation: false }, visitCalendar: { enabled: true, maxRangeDays: 92, maxEvents: 500, travelEstimate: 'LOCAL_HAVERSINE', exactLocationAfterConfirmation: true, autoConfirmation: false } } satisfies Partial<AppConfig>;
    expect(config.propertyComparison.detailedLocation).toBe(false);
    expect(config.visitCalendar.autoConfirmation).toBe(false);
  });
});

const sampleRate: ExchangeRate = {
  baseCurrency: 'KRW',
  quoteCurrency: 'USD',
  rate: '0.00073',
  provider: 'FRANKFURTER',
  sourceTimestamp: '2026-07-24T00:00:00.000Z',
  fetchedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:15:00.000Z',
  isStale: false,
};

describe('MenuState', () => {
  it('contains the six official LIFE HOME AI states', () => {
    expect(Object.values(MenuState)).toEqual([
      'ACTIVE',
      'HIDDEN',
      'READ_ONLY',
      'INTAKE_DISABLED',
      'DISABLED',
      'MAINTENANCE',
    ]);
  });
});

describe('PropertyReportStatus', () => {
  it('supports review history from open to terminal states', () => {
    expect(Object.values(PropertyReportStatus)).toEqual([
      'OPEN',
      'UNDER_REVIEW',
      'RESOLVED',
      'REJECTED',
    ]);
  });
});

describe('PropertyStatus', () => {
  it('keeps review and publication states explicit', () => {
    expect(Object.values(PropertyStatus)).toContain('PENDING_REVIEW');
    expect(Object.values(PropertyStatus)).toContain('ACTIVE');
    expect(Object.values(PropertyStatus)).toContain('REJECTED');
  });
});

describe('PropertyListingType', () => {
  it('distinguishes licensed brokerage from owner-direct listings', () => {
    expect(Object.values(PropertyListingType)).toEqual([
      'BROKERAGE',
      'OWNER_DIRECT',
    ]);
  });
});

describe('PropertyDealStatus', () => {
  it('keeps listing publication separate from transaction progress', () => {
    expect(Object.values(PropertyDealStatus)).toEqual([
      'AVAILABLE',
      'RESERVED',
      'CONTRACTING',
      'COMPLETED',
      'WITHDRAWN',
    ]);
  });
});

describe('ExchangeRate', () => {
  it('keeps source time and stale state explicit', () => {
    expect(sampleRate.provider).toBe('FRANKFURTER');
    expect(sampleRate.isStale).toBe(false);
  });
});

describe('VisitReservationStatus', () => {
  it('requires explicit approval before confirmation', () => {
    expect(VisitReservationStatus.REQUESTED).not.toBe(
      VisitReservationStatus.CONFIRMED,
    );
    expect(Object.values(VisitReservationStatus)).toContain(
      'ALTERNATIVE_PROPOSED',
    );
  });
});

describe('ReservationDepositStatus', () => {
  it('distinguishes paid, pending refund, and partial refund states', () => {
    expect(Object.values(ReservationDepositStatus)).toContain('PAID');
    expect(Object.values(ReservationDepositStatus)).toContain(
      'REFUND_PENDING',
    );
    expect(Object.values(ReservationDepositStatus)).toContain(
      'PARTIALLY_REFUNDED',
    );
  });
});

describe('NotificationDeliveryStatus', () => {
  it('distinguishes claimed work from pending and terminal states', () => {
    expect(Object.values(NotificationDeliveryStatus)).toEqual([
      'PENDING',
      'PROCESSING',
      'SENT',
      'SKIPPED',
      'FAILED',
    ]);
  });
});

describe('MediaUploadStatus', () => {
  it('keeps asynchronous media processing states explicit', () => {
    expect(Object.values(MediaUploadStatus)).toEqual([
      'REQUESTED',
      'PROCESSING',
      'READY',
      'FAILED',
    ]);
  });
});

describe('VisitTravelMode', () => {
  it('supports the route planning transport modes', () => {
    expect(Object.values(VisitTravelMode)).toEqual([
      'DRIVE',
      'TRANSIT',
      'WALK',
    ]);
  });
});

describe('ChatMessageType', () => {
  it('starts with immutable text and system message records', () => {
    expect(Object.values(ChatMessageType)).toEqual(['TEXT', 'SYSTEM']);
  });
});

describe('ElectronicContractProvider', () => {
  it('keeps provider selection explicit in the shared contract', () => {
    expect(Object.values(ElectronicContractProvider)).toEqual([
      'MODOOSIGN',
      'EFORM_SIGN',
      'GOVERNMENT',
    ]);
  });
});

describe('ElectronicContractStatus', () => {
  it('distinguishes signing progress from terminal outcomes', () => {
    expect(Object.values(ElectronicContractStatus)).toEqual([
      'DRAFT',
      'SIGNING_PENDING',
      'PARTIALLY_SIGNED',
      'SIGNED',
      'DECLINED',
      'CANCELLED',
      'EXPIRED',
      'FAILED',
    ]);
  });
});

describe('ContractSafetyRecheckStatus', () => {
  it('fails closed while preserving blocked and provider-failure outcomes', () => {
    expect(Object.values(ContractSafetyRecheckStatus)).toEqual([
      'RUNNING',
      'PASSED',
      'BLOCKED',
      'FAILED',
    ]);
  });
});

describe('LeaseSafetyGrade', () => {
  it('keeps unavailable evidence separate from risk grades', () => {
    expect(Object.values(LeaseSafetyGrade)).toEqual([
      'VERY_SAFE',
      'SAFE',
      'CAUTION',
      'HIGH_RISK',
      'CRITICAL',
      'UNAVAILABLE',
    ]);
    expect(GuaranteeEligibility.UNKNOWN).toBe('UNKNOWN');
  });
});
