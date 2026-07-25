import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  OwnershipVerificationStatus,
  PropertyListingType,
  PropertyStatus,
} from '../generated/prisma/client';
import {
  type OptimizeVisitRouteDto,
  VisitTravelMode,
} from './dto/optimize-visit-route.dto';

const MAX_PLAN_DAYS = 90;
const EARTH_RADIUS_KM = 6_371;

const travelProfiles: Record<
  VisitTravelMode,
  { averageSpeedKph: number; roadFactor: number }
> = {
  [VisitTravelMode.DRIVE]: { averageSpeedKph: 30, roadFactor: 1.25 },
  [VisitTravelMode.TRANSIT]: { averageSpeedKph: 20, roadFactor: 1.2 },
  [VisitTravelMode.WALK]: { averageSpeedKph: 4.5, roadFactor: 1.1 },
};

type Coordinate = {
  latitude: number;
  longitude: number;
};

type RoutableProperty = Coordinate & {
  id: string;
  listingNumber: string;
  title: string;
  city: string;
  addressLine1: string;
};

@Injectable()
export class VisitRoutePlannerService {
  constructor(private readonly prisma: PrismaService) {}

  async optimize(requesterId: string, dto: OptimizeVisitRouteDto) {
    const departureAt = new Date(dto.departureAt);
    const deadlineAt = dto.deadlineAt ? new Date(dto.deadlineAt) : null;
    this.validateWindow(departureAt, deadlineAt);

    const user = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { phoneVerifiedAt: true },
    });
    if (!user?.phoneVerifiedAt) {
      throw new ForbiddenException(
        '방문 동선 계획 전 휴대폰 본인인증이 필요합니다.',
      );
    }

    const properties = await this.prisma.property.findMany({
      where: {
        id: { in: dto.propertyIds },
        status: PropertyStatus.ACTIVE,
        OR: [
          { listingType: PropertyListingType.BROKERAGE },
          {
            listingType: PropertyListingType.OWNER_DIRECT,
            ownershipVerification: {
              status: OwnershipVerificationStatus.VERIFIED,
            },
          },
        ],
      },
      select: {
        id: true,
        listingNumber: true,
        title: true,
        city: true,
        addressLine1: true,
        latitude: true,
        longitude: true,
        brokerUserId: true,
      },
    });
    if (properties.length !== dto.propertyIds.length) {
      throw new NotFoundException(
        '선택한 매물 중 공개 중이 아니거나 찾을 수 없는 매물이 있습니다.',
      );
    }
    if (properties.some((property) => property.brokerUserId === requesterId)) {
      throw new ForbiddenException('본인 매물은 방문 동선에 포함할 수 없습니다.');
    }

    const missingCoordinates = properties
      .filter(
        (property) =>
          property.latitude === null || property.longitude === null,
      )
      .map((property) => property.id);
    if (missingCoordinates.length > 0) {
      throw new BadRequestException({
        message: '좌표가 등록되지 않은 매물은 동선을 계산할 수 없습니다.',
        propertyIds: missingCoordinates,
      });
    }

    const routable = properties.map((property) => ({
      id: property.id,
      listingNumber: property.listingNumber,
      title: property.title,
      city: property.city,
      addressLine1: property.addressLine1,
      latitude: Number(property.latitude),
      longitude: Number(property.longitude),
    }));
    const origin = {
      latitude: dto.startLatitude,
      longitude: dto.startLongitude,
    };
    const ordered = this.shortestPath(origin, routable);
    return this.schedule(origin, ordered, departureAt, deadlineAt, dto);
  }

  private validateWindow(departureAt: Date, deadlineAt: Date | null): void {
    const now = new Date();
    if (!Number.isFinite(departureAt.getTime())) {
      throw new BadRequestException('올바른 출발 시각이 필요합니다.');
    }
    if (departureAt <= now) {
      throw new BadRequestException('출발 시각은 현재 이후여야 합니다.');
    }
    if (
      departureAt.getTime() >
      now.getTime() + MAX_PLAN_DAYS * 24 * 60 * 60 * 1_000
    ) {
      throw new BadRequestException('방문 동선은 90일 이내로 계획해야 합니다.');
    }
    if (deadlineAt && deadlineAt <= departureAt) {
      throw new BadRequestException(
        '완료 희망 시각은 출발 시각 이후여야 합니다.',
      );
    }
  }

  private shortestPath(
    origin: Coordinate,
    properties: RoutableProperty[],
  ): RoutableProperty[] {
    let best: RoutableProperty[] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of this.permutations(properties)) {
      const distance = this.pathDistance(origin, candidate);
      const candidateKey = candidate.map((property) => property.id).join(':');
      const bestKey = best?.map((property) => property.id).join(':') ?? '';
      if (
        distance < bestDistance - Number.EPSILON ||
        (Math.abs(distance - bestDistance) <= Number.EPSILON &&
          candidateKey < bestKey)
      ) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best ?? [];
  }

  private permutations(items: RoutableProperty[]): RoutableProperty[][] {
    if (items.length <= 1) {
      return [items];
    }
    return items.flatMap((item, index) =>
      this.permutations(items.filter((_, itemIndex) => itemIndex !== index)).map(
        (rest) => [item, ...rest],
      ),
    );
  }

  private pathDistance(
    origin: Coordinate,
    properties: RoutableProperty[],
  ): number {
    let previous = origin;
    let total = 0;
    for (const property of properties) {
      total += this.straightLineDistance(previous, property);
      previous = property;
    }
    return total;
  }

  private schedule(
    origin: Coordinate,
    properties: RoutableProperty[],
    departureAt: Date,
    deadlineAt: Date | null,
    dto: OptimizeVisitRouteDto,
  ) {
    const profile = travelProfiles[dto.travelMode];
    const stops = [];
    let previous = origin;
    let cursor = new Date(departureAt);
    let totalDistanceKm = 0;
    let totalTravelMinutes = 0;

    for (const [index, property] of properties.entries()) {
      if (index > 0) {
        cursor = this.addMinutes(cursor, dto.bufferMinutes);
      }
      const straightLineKm = this.straightLineDistance(previous, property);
      const estimatedDistanceKm = straightLineKm * profile.roadFactor;
      const estimatedTravelMinutes =
        estimatedDistanceKm === 0
          ? 0
          : Math.max(
              1,
              Math.ceil(
                (estimatedDistanceKm / profile.averageSpeedKph) * 60,
              ),
            );
      const departAt = new Date(cursor);
      const arrivalAt = this.addMinutes(departAt, estimatedTravelMinutes);
      const visitEndAt = this.addMinutes(
        arrivalAt,
        dto.visitDurationMinutes,
      );
      totalDistanceKm += estimatedDistanceKm;
      totalTravelMinutes += estimatedTravelMinutes;
      stops.push({
        order: index + 1,
        property: {
          id: property.id,
          listingNumber: property.listingNumber,
          title: property.title,
          city: property.city,
          addressLine1: property.addressLine1,
          latitude: property.latitude,
          longitude: property.longitude,
        },
        leg: {
          straightLineDistanceKm: this.round(straightLineKm),
          estimatedDistanceKm: this.round(estimatedDistanceKm),
          estimatedTravelMinutes,
          departAt: departAt.toISOString(),
          arrivalAt: arrivalAt.toISOString(),
        },
        suggestedVisitWindow: {
          startAt: arrivalAt.toISOString(),
          endAt: visitEndAt.toISOString(),
        },
      });
      cursor = visitEndAt;
      previous = property;
    }

    const totalBufferMinutes = Math.max(
      0,
      (properties.length - 1) * dto.bufferMinutes,
    );
    return {
      planType: 'PRE_BOOKING_ESTIMATE',
      algorithm: 'EXACT_SHORTEST_PATH',
      travelMode: dto.travelMode,
      origin: {
        latitude: origin.latitude,
        longitude: origin.longitude,
        departureAt: departureAt.toISOString(),
      },
      estimateBasis: {
        distanceMethod: 'HAVERSINE_WITH_ROAD_FACTOR',
        averageSpeedKph: profile.averageSpeedKph,
        roadFactor: profile.roadFactor,
        realTimeTrafficIncluded: false,
      },
      stops,
      summary: {
        propertyCount: properties.length,
        totalEstimatedDistanceKm: this.round(totalDistanceKm),
        totalEstimatedTravelMinutes: totalTravelMinutes,
        totalVisitMinutes: properties.length * dto.visitDurationMinutes,
        totalBufferMinutes,
        completesAt: cursor.toISOString(),
        deadlineAt: deadlineAt?.toISOString() ?? null,
        fitsDeadline: deadlineAt ? cursor <= deadlineAt : null,
      },
      reservationPolicy: {
        autoConfirmed: false,
        registrantApprovalRequired: true,
        approver: 'PROPERTY_REGISTRANT',
      },
    };
  }

  private straightLineDistance(
    from: Coordinate,
    to: Coordinate,
  ): number {
    const latitudeDistance = this.toRadians(to.latitude - from.latitude);
    const longitudeDistance = this.toRadians(
      to.longitude - from.longitude,
    );
    const fromLatitude = this.toRadians(from.latitude);
    const toLatitude = this.toRadians(to.latitude);
    const haversine =
      Math.sin(latitudeDistance / 2) ** 2 +
      Math.cos(fromLatitude) *
        Math.cos(toLatitude) *
        Math.sin(longitudeDistance / 2) ** 2;
    return (
      2 *
      EARTH_RADIUS_KM *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private addMinutes(value: Date, minutes: number): Date {
    return new Date(value.getTime() + minutes * 60 * 1_000);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
