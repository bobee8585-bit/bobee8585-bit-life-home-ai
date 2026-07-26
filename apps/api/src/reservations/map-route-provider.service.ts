import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { VisitTravelMode } from './dto/optimize-visit-route.dto';

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapRouteLeg = {
  fromIndex: number;
  toIndex: number;
  distanceKm: number;
  travelMinutes: number;
  staticTravelMinutes: number | null;
  trafficIncluded: boolean;
};

export type MapRouteMatrix = {
  provider: 'GOOGLE_ROUTES';
  fetchedAt: Date;
  legs: Map<string, MapRouteLeg>;
};

@Injectable()
export class MapRouteProviderService {
  async matrix(
    points: MapCoordinate[],
    travelMode: VisitTravelMode,
    departureAt: Date,
  ): Promise<MapRouteMatrix | null> {
    if (this.mode() === 'DISABLED') {
      return null;
    }
    const apiKey = process.env.GOOGLE_ROUTES_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        '지도 경로 공급자 인증 설정이 없습니다.',
      );
    }

    const endpoint =
      process.env.GOOGLE_ROUTES_MATRIX_URL?.trim() ??
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
    if (
      process.env.NODE_ENV === 'production' &&
      !endpoint.startsWith('https://')
    ) {
      throw new ServiceUnavailableException(
        '운영 지도 경로 공급자는 HTTPS가 필요합니다.',
      );
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
          'x-goog-field-mask':
            'originIndex,destinationIndex,status,condition,distanceMeters,duration,staticDuration,fallbackInfo',
        },
        body: JSON.stringify(this.request(points, travelMode, departureAt)),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch {
      throw new ServiceUnavailableException(
        '지도 경로 공급자에 연결할 수 없습니다.',
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `지도 경로 공급자가 요청을 거부했습니다. (${response.status})`,
      );
    }

    return {
      provider: 'GOOGLE_ROUTES',
      fetchedAt: new Date(),
      legs: this.parse(await response.json(), points.length, travelMode),
    };
  }

  private request(
    points: MapCoordinate[],
    travelMode: VisitTravelMode,
    departureAt: Date,
  ): Record<string, unknown> {
    const waypoint = (point: MapCoordinate) => ({
      waypoint: {
        location: {
          latLng: {
            latitude: point.latitude,
            longitude: point.longitude,
          },
        },
      },
    });
    const body: Record<string, unknown> = {
      origins: points.map(waypoint),
      destinations: points.slice(1).map(waypoint),
      travelMode: travelMode,
    };
    if (travelMode === VisitTravelMode.DRIVE) {
      body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
      body.departureTime = departureAt.toISOString();
    } else if (travelMode === VisitTravelMode.TRANSIT) {
      body.departureTime = departureAt.toISOString();
    }
    return body;
  }

  private parse(
    value: unknown,
    pointCount: number,
    travelMode: VisitTravelMode,
  ): Map<string, MapRouteLeg> {
    if (!Array.isArray(value)) {
      throw new BadGatewayException(
        '지도 경로 공급자 응답 형식이 올바르지 않습니다.',
      );
    }
    const legs = new Map<string, MapRouteLeg>();
    for (const item of value) {
      const row = this.object(item);
      const fromIndex =
        row.originIndex === undefined ? 0 : this.integer(row.originIndex);
      const destinationIndex =
        row.destinationIndex === undefined
          ? 0
          : this.integer(row.destinationIndex);
      const toIndex =
        destinationIndex === null ? null : destinationIndex + 1;
      if (
        fromIndex === null ||
        toIndex === null ||
        fromIndex < 0 ||
        fromIndex >= pointCount ||
        toIndex < 1 ||
        toIndex >= pointCount ||
        fromIndex === toIndex
      ) {
        continue;
      }
      const status = this.object(row.status);
      if (
        (typeof status.code === 'number' && status.code !== 0) ||
        row.condition !== 'ROUTE_EXISTS'
      ) {
        continue;
      }
      const distanceMeters = this.number(row.distanceMeters);
      const travelSeconds = this.durationSeconds(row.duration);
      const staticSeconds = this.durationSeconds(row.staticDuration, true);
      if (
        distanceMeters === null ||
        distanceMeters < 0 ||
        travelSeconds === null ||
        travelSeconds < 0
      ) {
        continue;
      }
      const providerFallback =
        row.fallbackInfo !== undefined && row.fallbackInfo !== null;
      legs.set(this.key(fromIndex, toIndex), {
        fromIndex,
        toIndex,
        distanceKm: distanceMeters / 1_000,
        travelMinutes:
          travelSeconds === 0 ? 0 : Math.max(1, Math.ceil(travelSeconds / 60)),
        staticTravelMinutes:
          staticSeconds === null
            ? null
            : staticSeconds === 0
              ? 0
              : Math.max(1, Math.ceil(staticSeconds / 60)),
        trafficIncluded:
          travelMode === VisitTravelMode.DRIVE && !providerFallback,
      });
    }

    for (let fromIndex = 0; fromIndex < pointCount; fromIndex += 1) {
      for (let toIndex = 1; toIndex < pointCount; toIndex += 1) {
        if (
          fromIndex !== toIndex &&
          !legs.has(this.key(fromIndex, toIndex))
        ) {
          throw new BadGatewayException(
            '지도 경로 공급자가 일부 이동 구간을 반환하지 않았습니다.',
          );
        }
      }
    }
    return legs;
  }

  private mode(): 'GOOGLE_ROUTES' | 'DISABLED' {
    return process.env.MAP_ROUTE_PROVIDER?.trim().toUpperCase() ===
      'GOOGLE_ROUTES'
      ? 'GOOGLE_ROUTES'
      : 'DISABLED';
  }

  private timeoutMs(): number {
    const value = Number(process.env.MAP_ROUTE_PROVIDER_TIMEOUT_MS);
    return Number.isInteger(value) && value > 0 ? value : 7_000;
  }

  private key(fromIndex: number, toIndex: number): string {
    return `${fromIndex}:${toIndex}`;
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private integer(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  }

  private number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private durationSeconds(
    value: unknown,
    optional = false,
  ): number | null {
    if (value === undefined && optional) {
      return null;
    }
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?s$/.test(value)) {
      return null;
    }
    const seconds = Number(value.slice(0, -1));
    return Number.isFinite(seconds) ? seconds : null;
  }
}
