import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  PropertyReportStatus,
  PropertyStatus,
} from '../generated/prisma/client';
import type { CreatePropertyReportDto } from './dto/create-property-report.dto';
import type { ListPropertyReportsDto } from './dto/list-property-reports.dto';
import type { ReviewPropertyReportDto } from './dto/review-property-report.dto';

@Injectable()
export class PropertyReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    reporterId: string,
    propertyId: string,
    dto: CreatePropertyReportDto,
  ) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, status: PropertyStatus.ACTIVE },
      select: { id: true, brokerUserId: true, listingNumber: true },
    });
    if (!property) {
      throw new NotFoundException('공개 중인 매물을 찾을 수 없습니다.');
    }
    if (property.brokerUserId === reporterId) {
      throw new ForbiddenException('본인이 등록한 매물은 신고할 수 없습니다.');
    }
    const duplicate = await this.prisma.propertyReport.findFirst({
      where: {
        propertyId,
        reporterId,
        status: {
          in: [
            PropertyReportStatus.OPEN,
            PropertyReportStatus.UNDER_REVIEW,
          ],
        },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('이미 처리 중인 신고가 있습니다.');
    }

    const report = await this.prisma.propertyReport.create({
      data: {
        id: createId(),
        propertyId,
        reporterId,
        reason: dto.reason,
        description: dto.description.trim(),
        evidenceUrls: dto.evidenceUrls,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        id: createId(),
        actorId: reporterId,
        action: 'PROPERTY_REPORT.CREATE',
        targetType: 'PropertyReport',
        targetId: report.id,
        afterData: {
          propertyId,
          listingNumber: property.listingNumber,
          reason: dto.reason,
          status: PropertyReportStatus.OPEN,
        },
      },
    });
    return this.view(report);
  }

  async mine(reporterId: string) {
    const reports = await this.prisma.propertyReport.findMany({
      where: { reporterId },
      include: {
        property: {
          select: { listingNumber: true, title: true, status: true },
        },
        histories: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reports.map((report) => this.view(report));
  }

  async list(query: ListPropertyReportsDto) {
    const where = query.status ? { status: query.status } : {};
    const [reports, total] = await this.prisma.$transaction([
      this.prisma.propertyReport.findMany({
        where,
        include: {
          property: {
            select: { listingNumber: true, title: true, status: true },
          },
          reporter: {
            select: { memberNumber: true },
          },
          histories: {
            include: {
              actor: { select: { memberNumber: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.propertyReport.count({ where }),
    ]);
    return {
      items: reports.map((report) => this.view(report)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async review(
    reportId: string,
    reviewerId: string,
    dto: ReviewPropertyReportDto,
  ) {
    if (dto.status === PropertyReportStatus.OPEN) {
      throw new BadRequestException('신고 상태를 OPEN으로 되돌릴 수 없습니다.');
    }
    if (
      dto.deactivateProperty &&
      dto.status !== PropertyReportStatus.RESOLVED
    ) {
      throw new BadRequestException(
        '매물 비공개 처리는 신고 해결 상태에서만 가능합니다.',
      );
    }
    const report = await this.prisma.propertyReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        propertyId: true,
        status: true,
      },
    });
    if (!report) {
      throw new NotFoundException('신고를 찾을 수 없습니다.');
    }
    if (
      report.status === PropertyReportStatus.RESOLVED ||
      report.status === PropertyReportStatus.REJECTED
    ) {
      throw new ConflictException('이미 종결된 신고입니다.');
    }
    if (
      report.status === PropertyReportStatus.UNDER_REVIEW &&
      dto.status === PropertyReportStatus.UNDER_REVIEW
    ) {
      throw new ConflictException('이미 검수 중인 신고입니다.');
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.propertyReport.updateMany({
        where: { id: reportId, status: report.status },
        data: {
          status: dto.status,
          assignedTo: reviewerId,
          resolution: dto.resolution.trim(),
          resolvedAt:
            dto.status === PropertyReportStatus.RESOLVED ||
            dto.status === PropertyReportStatus.REJECTED
              ? now
              : null,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('신고 상태가 변경되어 다시 확인해야 합니다.');
      }
      await transaction.propertyReportHistory.create({
        data: {
          id: createId(),
          reportId,
          actorId: reviewerId,
          previousStatus: report.status,
          nextStatus: dto.status,
          note: dto.resolution.trim(),
        },
      });
      if (dto.deactivateProperty) {
        await transaction.property.updateMany({
          where: {
            id: report.propertyId,
            status: PropertyStatus.ACTIVE,
          },
          data: { status: PropertyStatus.INACTIVE },
        });
      }
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: reviewerId,
          action: 'PROPERTY_REPORT.REVIEW',
          targetType: 'PropertyReport',
          targetId: reportId,
          reason: dto.resolution.trim(),
          beforeData: { status: report.status },
          afterData: {
            status: dto.status,
            propertyDeactivated: dto.deactivateProperty,
          },
        },
      });
      return transaction.propertyReport.findUniqueOrThrow({
        where: { id: reportId },
        include: {
          property: {
            select: { listingNumber: true, title: true, status: true },
          },
          reporter: { select: { memberNumber: true } },
          histories: {
            include: {
              actor: { select: { memberNumber: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });
    return this.view(updated);
  }

  private view(report: {
    id: string;
    propertyId: string;
    reporterId: string;
    reason: string;
    description: string;
    evidenceUrls: string[];
    status: PropertyReportStatus;
    assignedTo: string | null;
    resolution: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    property?: {
      listingNumber: string;
      title: string;
      status: PropertyStatus;
    };
    reporter?: { memberNumber: string };
    histories?: Array<{
      id: string;
      previousStatus: PropertyReportStatus;
      nextStatus: PropertyReportStatus;
      note: string;
      createdAt: Date;
      actor?: { memberNumber: string };
    }>;
  }) {
    return {
      id: report.id,
      propertyId: report.propertyId,
      property: report.property,
      reporterMemberNumber: report.reporter?.memberNumber,
      reason: report.reason,
      description: report.description,
      evidenceUrls: report.evidenceUrls,
      status: report.status,
      assignedTo: report.assignedTo,
      resolution: report.resolution,
      resolvedAt: report.resolvedAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      history: report.histories?.map((history) => ({
        id: history.id,
        previousStatus: history.previousStatus,
        nextStatus: history.nextStatus,
        note: history.note,
        actorMemberNumber: history.actor?.memberNumber,
        createdAt: history.createdAt.toISOString(),
      })),
    };
  }
}
