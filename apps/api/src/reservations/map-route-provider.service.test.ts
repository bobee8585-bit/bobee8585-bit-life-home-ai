import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisitTravelMode } from './dto/optimize-visit-route.dto';
import { MapRouteProviderService } from './map-route-provider.service';

const originalEnv = { ...process.env };
const points = [
  { latitude: 37.5665, longitude: 126.978 },
  { latitude: 37.57, longitude: 126.99 },
  { latitude: 37.58, longitude: 127.01 },
];

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('MapRouteProviderService', () => {
  it('stays disabled unless an operating provider is selected', async () => {
    delete process.env.MAP_ROUTE_PROVIDER;
    await expect(
      new MapRouteProviderService().matrix(
        points,
        VisitTravelMode.DRIVE,
        new Date(),
      ),
    ).resolves.toBeNull();
  });

  it('requests a complete traffic-aware route matrix without exposing its key', async () => {
    process.env.MAP_ROUTE_PROVIDER = 'GOOGLE_ROUTES';
    process.env.GOOGLE_ROUTES_API_KEY = 'server-secret';
    const rows = [
      [0, 0, 1_200, '600s', '480s'],
      [0, 1, 2_400, '900s', '720s'],
      [1, 1, 1_500, '720s', '600s'],
      [2, 0, 1_300, '660s', '540s'],
    ].map(
      ([
        originIndex,
        destinationIndex,
        distanceMeters,
        duration,
        staticDuration,
      ]) => ({
        ...(originIndex === 0 ? {} : { originIndex }),
        ...(destinationIndex === 0 ? {} : { destinationIndex }),
        condition: 'ROUTE_EXISTS',
        status: {},
        distanceMeters,
        duration,
        staticDuration,
      }),
    );
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new MapRouteProviderService().matrix(
      points,
      VisitTravelMode.DRIVE,
      new Date('2026-07-28T01:00:00.000Z'),
    );

    expect(result?.legs.get('0:1')).toMatchObject({
      distanceKm: 1.2,
      travelMinutes: 10,
      staticTravelMinutes: 8,
      trafficIncluded: true,
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      'x-goog-api-key': 'server-secret',
    });
    expect(String(request.body)).not.toContain('server-secret');
    expect(JSON.parse(String(request.body))).toMatchObject({
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    });
  });

  it('rejects incomplete matrices instead of optimizing with missing legs', async () => {
    process.env.MAP_ROUTE_PROVIDER = 'GOOGLE_ROUTES';
    process.env.GOOGLE_ROUTES_API_KEY = 'server-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            {
              originIndex: 0,
              destinationIndex: 0,
              condition: 'ROUTE_EXISTS',
              status: {},
              distanceMeters: 100,
              duration: '60s',
            },
          ]),
          { status: 200 },
        ),
      ),
    );

    await expect(
      new MapRouteProviderService().matrix(
        points,
        VisitTravelMode.DRIVE,
        new Date(),
      ),
    ).rejects.toThrow(BadGatewayException);
  });

  it('requires server-side credentials when the provider is enabled', async () => {
    process.env.MAP_ROUTE_PROVIDER = 'GOOGLE_ROUTES';
    delete process.env.GOOGLE_ROUTES_API_KEY;
    await expect(
      new MapRouteProviderService().matrix(
        points,
        VisitTravelMode.DRIVE,
        new Date(),
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
