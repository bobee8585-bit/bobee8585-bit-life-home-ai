import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  OptimizeVisitRouteDto,
  VisitTravelMode,
} from './dto/optimize-visit-route.dto';
import { VisitRoutePlannerService } from './visit-route-planner.service';

const property = (
  id: string,
  latitude: number | null,
  longitude: number | null,
) => ({
  id,
  listingNumber: `LH-${id}`,
  title: `매물 ${id}`,
  city: '서울',
  addressLine1: `서울특별시 테스트로 ${id}`,
  latitude,
  longitude,
  brokerUserId: 'broker',
});

const dto = (): OptimizeVisitRouteDto => ({
  propertyIds: ['property-a', 'property-b', 'property-c'],
  departureAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
  startLatitude: 37.5665,
  startLongitude: 126.978,
  travelMode: VisitTravelMode.DRIVE,
  visitDurationMinutes: 60,
  bufferMinutes: 15,
});

describe('VisitRoutePlannerService', () => {
  it('finds the shortest complete route and schedules every property', async () => {
    const input = dto();
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({ phoneVerifiedAt: new Date() })),
      },
      property: {
        findMany: vi.fn(async () => [
          property('property-c', 37.58, 127.03),
          property('property-a', 37.567, 126.98),
          property('property-b', 37.57, 127.0),
        ]),
      },
    } as unknown as PrismaService;

    const result = await new VisitRoutePlannerService(prisma).optimize(
      'requester',
      input,
    );

    expect(result.algorithm).toBe('EXACT_SHORTEST_PATH');
    expect(result.stops.map((stop) => stop.property.id)).toEqual([
      'property-a',
      'property-b',
      'property-c',
    ]);
    expect(result.summary.propertyCount).toBe(3);
    expect(result.summary.totalBufferMinutes).toBe(30);
    expect(result.estimateBasis.realTimeTrafficIncluded).toBe(false);
    expect(result.reservationPolicy.autoConfirmed).toBe(false);
    expect(result.reservationPolicy.registrantApprovalRequired).toBe(true);
    expect(result.reservationPolicy.approver).toBe('PROPERTY_REGISTRANT');
  });

  it('reports whether the optimized route fits a requested deadline', async () => {
    const input = dto();
    input.deadlineAt = new Date(
      new Date(input.departureAt).getTime() + 30 * 60 * 1_000,
    ).toISOString();
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({ phoneVerifiedAt: new Date() })),
      },
      property: {
        findMany: vi.fn(async () => [
          property('property-a', 37.567, 126.98),
          property('property-b', 37.57, 127.0),
          property('property-c', 37.58, 127.03),
        ]),
      },
    } as unknown as PrismaService;

    const result = await new VisitRoutePlannerService(prisma).optimize(
      'requester',
      input,
    );

    expect(result.summary.fitsDeadline).toBe(false);
  });

  it('rejects a property without coordinates', async () => {
    const input = dto();
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({ phoneVerifiedAt: new Date() })),
      },
      property: {
        findMany: vi.fn(async () => [
          property('property-a', 37.567, 126.98),
          property('property-b', null, null),
          property('property-c', 37.58, 127.03),
        ]),
      },
    } as unknown as PrismaService;

    await expect(
      new VisitRoutePlannerService(prisma).optimize('requester', input),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires phone identity verification before route planning', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({ phoneVerifiedAt: null })),
      },
    } as unknown as PrismaService;

    await expect(
      new VisitRoutePlannerService(prisma).optimize('requester', dto()),
    ).rejects.toThrow(ForbiddenException);
  });
});
