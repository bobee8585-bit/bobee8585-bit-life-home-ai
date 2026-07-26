import { describe, expect, it } from 'vitest';
import {
  type ExchangeRate,
  MenuState,
  PropertyReportStatus,
  PropertyStatus,
  VisitReservationStatus,
  ReservationDepositStatus,
  NotificationDeliveryStatus,
  MediaUploadStatus,
  PropertyListingType,
  VisitTravelMode,
  ChatMessageType,
  ElectronicContractProvider,
  ElectronicContractStatus,
} from './index';

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
