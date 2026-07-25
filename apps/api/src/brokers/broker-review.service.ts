import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { PrismaService } from '../database/prisma.service';
import {
  BrokerageStatus,
  BrokerStatus,
} from '../generated/prisma/client';
import type { ListBrokerRegistrationsDto } from './dto/list-broker-registrations.dto';

type ReviewResult = {
  brokerUserId: string;
  brokerStatus: BrokerStatus;
  brokerageStatus: BrokerageStatus;
  reviewedAt: string;
};

@Injectable()
export class BrokerReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sensitiveData: SensitiveDataService,
  ) {}

  async list(query: ListBrokerRegistrationsDto): Promise<{
    items: Array<Record<string, unknown>>;
    page: number;
    limit: number;
    total: number;
  }> {
    const where = { status: query.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.brokerProfile.findMany({
        where,
        include: {
          user: {
            select: {
              memberNumber: true,
              email: true,
              phoneVerifiedAt: true,
              emailVerifiedAt: true,
            },
          },
          brokerageOffice: true,
        },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.brokerProfile.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        brokerUserId: row.userId,
        memberNumber: row.user.memberNumber,
        email: row.user.email,
        emailVerified: Boolean(row.user.emailVerifiedAt),
        phoneVerified: Boolean(row.user.phoneVerifiedAt),
        legalName: this.sensitiveData.decrypt(row.legalNameEncrypted),
        licenseNumber: row.licenseNumber,
        status: row.status,
        submittedAt: row.createdAt.toISOString(),
        brokerageOffice: {
          id: row.brokerageOffice.id,
          name: row.brokerageOffice.name,
          representativeName: this.sensitiveData.decrypt(
            row.brokerageOffice.representativeNameEncrypted,
          ),
          businessRegistrationNumber:
            row.brokerageOffice.businessRegistrationNo,
          brokerageRegistrationNumber:
            row.brokerageOffice.brokerageRegistrationNo,
          address: [
            row.brokerageOffice.addressLine1,
            row.brokerageOffice.addressLine2,
          ]
            .filter(Boolean)
            .join(' '),
          status: row.brokerageOffice.status,
        },
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async approve(
    brokerUserId: string,
    reviewerId: string,
    reason: string,
  ): Promise<ReviewResult> {
    const registration = await this.registration(brokerUserId);
    const brokerRole = await this.prisma.role.findUnique({
      where: { code: 'BROKER' },
      select: { id: true },
    });
    const managerRole = await this.prisma.role.findUnique({
      where: { code: 'BROKER_MANAGER' },
      select: { id: true },
    });
    if (!brokerRole || !managerRole) {
      throw new ConflictException('중개사 역할 초기화가 필요합니다.');
    }
    const reviewedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.brokerProfile.updateMany({
        where: { userId: brokerUserId, status: BrokerStatus.PENDING },
        data: {
          status: BrokerStatus.ACTIVE,
          reviewedBy: reviewerId,
          reviewedAt,
          rejectionReason: null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('이미 처리된 중개사 신청입니다.');
      }
      await transaction.brokerageOffice.update({
        where: { id: registration.brokerageOfficeId },
        data: {
          status: BrokerageStatus.ACTIVE,
          reviewedBy: reviewerId,
          reviewedAt,
          rejectionReason: null,
        },
      });
      for (const roleId of [brokerRole.id, managerRole.id]) {
        await transaction.userRole.upsert({
          where: { userId_roleId: { userId: brokerUserId, roleId } },
          update: {
            startsAt: reviewedAt,
            expiresAt: null,
            grantedBy: reviewerId,
          },
          create: {
            userId: brokerUserId,
            roleId,
            startsAt: reviewedAt,
            grantedBy: reviewerId,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: reviewerId,
          action: 'BROKER_REGISTRATION.APPROVE',
          targetType: 'BrokerProfile',
          targetId: brokerUserId,
          reason,
          beforeData: { status: BrokerStatus.PENDING },
          afterData: { status: BrokerStatus.ACTIVE },
        },
      });
    });
    return {
      brokerUserId,
      brokerStatus: BrokerStatus.ACTIVE,
      brokerageStatus: BrokerageStatus.ACTIVE,
      reviewedAt: reviewedAt.toISOString(),
    };
  }

  async reject(
    brokerUserId: string,
    reviewerId: string,
    reason: string,
  ): Promise<ReviewResult> {
    const registration = await this.registration(brokerUserId);
    const reviewedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.brokerProfile.updateMany({
        where: { userId: brokerUserId, status: BrokerStatus.PENDING },
        data: {
          status: BrokerStatus.REJECTED,
          reviewedBy: reviewerId,
          reviewedAt,
          rejectionReason: reason,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('이미 처리된 중개사 신청입니다.');
      }
      await transaction.brokerageOffice.update({
        where: { id: registration.brokerageOfficeId },
        data: {
          status: BrokerageStatus.REJECTED,
          reviewedBy: reviewerId,
          reviewedAt,
          rejectionReason: reason,
        },
      });
      await transaction.auditLog.create({
        data: {
          id: createId(),
          actorId: reviewerId,
          action: 'BROKER_REGISTRATION.REJECT',
          targetType: 'BrokerProfile',
          targetId: brokerUserId,
          reason,
          beforeData: { status: BrokerStatus.PENDING },
          afterData: { status: BrokerStatus.REJECTED },
        },
      });
    });
    return {
      brokerUserId,
      brokerStatus: BrokerStatus.REJECTED,
      brokerageStatus: BrokerageStatus.REJECTED,
      reviewedAt: reviewedAt.toISOString(),
    };
  }

  private async registration(userId: string): Promise<{
    brokerageOfficeId: string;
  }> {
    const registration = await this.prisma.brokerProfile.findUnique({
      where: { userId },
      select: { brokerageOfficeId: true },
    });
    if (!registration) {
      throw new NotFoundException('중개사 신청을 찾을 수 없습니다.');
    }
    return registration;
  }
}
