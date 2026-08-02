import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { VisitReservationStatus } from '../generated/prisma/client';
import type { VisitCalendarQueryDto } from './dto/visit-calendar-query.dto';

const MAX_RANGE_DAYS = 92;
const MAX_EVENTS = 500;
const ACTIVE = new Set<VisitReservationStatus>([
  VisitReservationStatus.REQUESTED,
  VisitReservationStatus.ALTERNATIVE_PROPOSED,
  VisitReservationStatus.CONFIRMED,
]);

@Injectable()
export class VisitCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, query: VisitCalendarQueryDto) {
    this.assertTimezone(query.timezone);
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const toExclusive = new Date(`${query.to}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(toExclusive.getTime()) || toExclusive <= from) {
      throw new BadRequestException('조회 기간이 올바르지 않습니다.');
    }
    if ((toExclusive.getTime() - from.getTime()) / 86400000 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`방문 일정은 최대 ${MAX_RANGE_DAYS}일까지 조회할 수 있습니다.`);
    }
    const rows = await this.prisma.visitReservation.findMany({
      where: { OR: [{ requesterId: userId }, { brokerUserId: userId }] },
      orderBy: { requestedStartAt: 'asc' },
      take: MAX_EVENTS + 1,
      include: { property: { select: { id: true, listingNumber: true, title: true, city: true, region1: true, addressLine1: true, addressLine2: true, latitude: true, longitude: true } } },
    });
    const events = rows.map((row) => {
      const window = this.window(row);
      if (!window || window.endAt <= from || window.startAt >= toExclusive) return null;
      const exactLocation = row.status === VisitReservationStatus.CONFIRMED || row.status === VisitReservationStatus.COMPLETED;
      return {
        id: row.id, reservationNumber: row.reservationNumber, status: row.status,
        role: row.requesterId === userId ? 'REQUESTER' as const : 'REGISTRANT' as const,
        windowSource: window.source, startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString(),
        date: this.localDate(window.startAt, query.timezone),
        property: { id: row.property.id, listingNumber: row.property.listingNumber, title: row.property.title, location: exactLocation ? { region1: row.property.region1, city: row.property.city, addressLine1: row.property.addressLine1, addressLine2: row.property.addressLine2 } : { region1: row.property.region1, city: row.property.city }, latitude: row.property.latitude?.toString() ?? null, longitude: row.property.longitude?.toString() ?? null },
        alerts: [] as Array<{ severity: 'ERROR' | 'WARNING'; code: string; relatedReservationId: string; requiredMinutes?: number; availableMinutes?: number }>,
        active: ACTIVE.has(row.status),
      };
    }).filter((event): event is NonNullable<typeof event> => event !== null).slice(0, MAX_EVENTS);
    const active = events.filter((event) => event.active).sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (let index = 0; index < active.length; index += 1) {
      for (let next = index + 1; next < active.length; next += 1) {
        if (active[next].startAt >= active[index].endAt) break;
        active[index].alerts.push({ severity: 'ERROR', code: 'SCHEDULE_OVERLAP', relatedReservationId: active[next].id });
        active[next].alerts.push({ severity: 'ERROR', code: 'SCHEDULE_OVERLAP', relatedReservationId: active[index].id });
      }
      const following = active[index + 1];
      if (following && active[index].endAt <= following.startAt) {
        const requiredMinutes = this.travelMinutes(active[index].property, following.property, query.travelMode);
        const availableMinutes = Math.floor((new Date(following.startAt).getTime() - new Date(active[index].endAt).getTime()) / 60000);
        if (requiredMinutes !== null && availableMinutes < requiredMinutes) {
          following.alerts.push({ severity: 'WARNING', code: 'TRAVEL_TIME_INSUFFICIENT', relatedReservationId: active[index].id, requiredMinutes, availableMinutes });
        }
      }
    }
    const grouped = new Map<string, typeof events>();
    for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
    return { from: query.from, to: query.to, timezone: query.timezone, travelMode: query.travelMode, days: [...grouped.entries()].map(([date, dayEvents]) => ({ date, events: dayEvents })), limits: { maxRangeDays: MAX_RANGE_DAYS, maxEvents: MAX_EVENTS }, travelEstimate: 'LOCAL_HAVERSINE' };
  }

  private window(row: { status: VisitReservationStatus; requestedStartAt: Date; requestedEndAt: Date; alternativeStartAt: Date | null; alternativeEndAt: Date | null; confirmedStartAt: Date | null; confirmedEndAt: Date | null }) {
    if ((row.status === VisitReservationStatus.CONFIRMED || row.status === VisitReservationStatus.COMPLETED) && row.confirmedStartAt && row.confirmedEndAt) return { source: 'CONFIRMED' as const, startAt: row.confirmedStartAt, endAt: row.confirmedEndAt };
    if (row.status === VisitReservationStatus.ALTERNATIVE_PROPOSED && row.alternativeStartAt && row.alternativeEndAt) return { source: 'ALTERNATIVE' as const, startAt: row.alternativeStartAt, endAt: row.alternativeEndAt };
    return { source: 'REQUESTED' as const, startAt: row.requestedStartAt, endAt: row.requestedEndAt };
  }

  private localDate(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  private assertTimezone(timezone: string) { try { new Intl.DateTimeFormat('ko-KR', { timeZone: timezone }).format(); } catch { throw new BadRequestException('지원하지 않는 시간대입니다.'); } }

  private travelMinutes(from: { latitude: string | null; longitude: string | null }, to: { latitude: string | null; longitude: string | null }, mode: 'DRIVE' | 'TRANSIT' | 'WALK') {
    if (!from.latitude || !from.longitude || !to.latitude || !to.longitude) return null;
    const rad = (value: number) => value * Math.PI / 180;
    const lat1 = Number(from.latitude), lat2 = Number(to.latitude), dLat = rad(lat2 - lat1), dLon = rad(Number(to.longitude) - Number(from.longitude));
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.25;
    const speed = mode === 'WALK' ? 4.5 : mode === 'TRANSIT' ? 22 : 30;
    return Math.max(5, Math.ceil(distanceKm / speed * 60 + (mode === 'TRANSIT' ? 10 : 5)));
  }
}
