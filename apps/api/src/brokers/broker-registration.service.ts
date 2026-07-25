import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { SensitiveDataService } from '../common/sensitive-data.service';
import { PrismaService } from '../database/prisma.service';
import type { CreateBrokerRegistrationDto } from './dto/create-broker-registration.dto';

export type BrokerRegistrationResult = {
  brokerUserId: string;
  brokerageOfficeId: string;
  brokerStatus: 'PENDING';
  brokerageStatus: 'PENDING';
  submittedAt: string;
};

@Injectable()
export class BrokerRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sensitiveData: SensitiveDataService,
  ) {}

  async create(
    userId: string,
    dto: CreateBrokerRegistrationDto,
  ): Promise<BrokerRegistrationResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        brokerProfile: { select: { userId: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('회원을 찾을 수 없습니다.');
    }
    if (!user.emailVerifiedAt || !user.phoneVerifiedAt) {
      throw new ForbiddenException(
        '중개사 등록 전 이메일과 휴대폰 인증이 필요합니다.',
      );
    }
    if (user.brokerProfile) {
      throw new ConflictException('이미 중개사 등록 신청이 존재합니다.');
    }

    const officeId = createId();
    const submittedAt = new Date();
    const normalizedPhone = `${dto.phoneCountryCode}:${dto.phoneNumber}`;
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.brokerageOffice.create({
          data: {
            id: officeId,
            businessRegistrationNo: dto.businessRegistrationNumber,
            brokerageRegistrationNo: dto.brokerageRegistrationNumber,
            name: dto.officeName,
            representativeNameEncrypted: this.sensitiveData.encrypt(
              dto.representativeName,
            ),
            phoneCountryCode: dto.phoneCountryCode,
            phoneNumberEncrypted: this.sensitiveData.encrypt(dto.phoneNumber),
            phoneHash: this.sensitiveData.hash(normalizedPhone),
            postalCode: dto.postalCode,
            addressLine1: dto.addressLine1,
            addressLine2: dto.addressLine2 || null,
            createdAt: submittedAt,
          },
        });
        await transaction.brokerProfile.create({
          data: {
            userId,
            brokerageOfficeId: officeId,
            licenseNumber: dto.licenseNumber,
            legalNameEncrypted: this.sensitiveData.encrypt(dto.legalName),
            createdAt: submittedAt,
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: userId,
            action: 'BROKER_REGISTRATION.SUBMIT',
            targetType: 'BrokerProfile',
            targetId: userId,
            afterData: {
              brokerageOfficeId: officeId,
              brokerStatus: 'PENDING',
              brokerageStatus: 'PENDING',
            },
          },
        });
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          '이미 등록된 자격번호 또는 중개사무소 번호입니다.',
        );
      }
      throw error;
    }

    return {
      brokerUserId: userId,
      brokerageOfficeId: officeId,
      brokerStatus: 'PENDING',
      brokerageStatus: 'PENDING',
      submittedAt: submittedAt.toISOString(),
    };
  }
}
