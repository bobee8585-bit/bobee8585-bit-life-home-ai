import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { VisitReservationStatus } from '../generated/prisma/client';
import { VisitCalendarService } from './visit-calendar.service';

const property = { id: 'property', listingNumber: 'LH-1', title: '테스트 매물', region1: '서울', city: '서울', addressLine1: '테헤란로 1', addressLine2: '101호', latitude: { toString: () => '37.5' }, longitude: { toString: () => '127.0' } };
const row = (id: string, status: VisitReservationStatus, start: string, end: string, override = {}) => ({ id, reservationNumber: `R-${id}`, requesterId: 'member', brokerUserId: 'broker', status, requestedStartAt: new Date(start), requestedEndAt: new Date(end), alternativeStartAt: null, alternativeEndAt: null, confirmedStartAt: status === VisitReservationStatus.CONFIRMED ? new Date(start) : null, confirmedEndAt: status === VisitReservationStatus.CONFIRMED ? new Date(end) : null, property, ...override });
const query = { from: '2026-08-02', to: '2026-08-03', timezone: 'Asia/Seoul', travelMode: 'DRIVE' as const };
const service = (rows: unknown[]) => new VisitCalendarService({ visitReservation: { findMany: vi.fn(async () => rows) } } as unknown as PrismaService);

describe('VisitCalendarService', () => {
  it('returns an empty grouped calendar', async () => { expect((await service([]).get('member', query)).days).toEqual([]); });
  it('hides exact address before confirmation', async () => { const result = await service([row('one', VisitReservationStatus.REQUESTED, '2026-08-02T01:00:00Z', '2026-08-02T02:00:00Z')]).get('member', query); expect(result.days[0]?.events[0]?.property.location).not.toHaveProperty('addressLine1'); });
  it('reveals exact address after confirmation', async () => { const result = await service([row('one', VisitReservationStatus.CONFIRMED, '2026-08-02T01:00:00Z', '2026-08-02T02:00:00Z')]).get('member', query); expect(result.days[0]?.events[0]?.property.location).toHaveProperty('addressLine1', '테헤란로 1'); });
  it('marks overlapping active reservations as errors', async () => { const result = await service([row('one', VisitReservationStatus.REQUESTED, '2026-08-02T01:00:00Z', '2026-08-02T03:00:00Z'), row('two', VisitReservationStatus.CONFIRMED, '2026-08-02T02:00:00Z', '2026-08-02T04:00:00Z')]).get('member', query); expect(result.days[0]?.events.flatMap((event) => event.alerts).filter((alert) => alert.code === 'SCHEDULE_OVERLAP')).toHaveLength(2); });
  it('warns when travel time exceeds the available gap', async () => { const far = { ...property, id: 'far', latitude: { toString: () => '37.7' }, longitude: { toString: () => '127.2' } }; const result = await service([row('one', VisitReservationStatus.CONFIRMED, '2026-08-02T01:00:00Z', '2026-08-02T02:00:00Z'), row('two', VisitReservationStatus.CONFIRMED, '2026-08-02T02:05:00Z', '2026-08-02T03:00:00Z', { property: far })]).get('member', query); expect(result.days[0]?.events[1]?.alerts[0]?.code).toBe('TRAVEL_TIME_INSUFFICIENT'); });
  it('rejects ranges beyond 92 days', async () => { await expect(service([]).get('member', { ...query, to: '2026-12-31' })).rejects.toBeInstanceOf(BadRequestException); });
});
