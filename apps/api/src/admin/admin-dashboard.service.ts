import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  BrokerStatus,
  ContractSafetyRecheckStatus,
  ContractWebhookEventStatus,
  NotificationDeliveryStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
  PropertyReportStatus,
  PropertyStatus,
  ReservationDepositStatus,
} from '../generated/prisma/client';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const [
      pendingBrokers,
      pendingProperties,
      openReports,
      pendingRefunds,
      overdueRefunds,
      failedRefunds,
      failedNotifications,
      failedContractWebhooks,
      failedContractSafetyRechecks,
    ] = await this.prisma.$transaction([
      this.prisma.brokerProfile.count({
        where: { status: BrokerStatus.PENDING },
      }),
      this.prisma.property.count({
        where: { status: PropertyStatus.PENDING_REVIEW },
      }),
      this.prisma.propertyReport.count({
        where: {
          status: {
            in: [
              PropertyReportStatus.OPEN,
              PropertyReportStatus.UNDER_REVIEW,
            ],
          },
        },
      }),
      this.prisma.reservationDeposit.count({
        where: { status: ReservationDepositStatus.REFUND_PENDING },
      }),
      this.prisma.reservationDeposit.count({
        where: {
          status: ReservationDepositStatus.REFUND_PENDING,
          refundDueAt: { lt: now },
        },
      }),
      this.prisma.paymentTransaction.count({
        where: {
          type: PaymentTransactionType.REFUND,
          status: PaymentTransactionStatus.FAILED,
        },
      }),
      this.prisma.notificationOutbox.count({
        where: { status: NotificationDeliveryStatus.FAILED },
      }),
      this.prisma.contractWebhookEvent.count({
        where: { status: ContractWebhookEventStatus.FAILED },
      }),
      this.prisma.contractSafetyRecheck.count({
        where: { status: ContractSafetyRecheckStatus.FAILED },
      }),
    ]);

    const urgentCount =
      overdueRefunds +
      failedRefunds +
      failedNotifications +
      failedContractWebhooks +
      failedContractSafetyRechecks;

    return {
      reviewQueues: {
        pendingBrokers,
        pendingProperties,
        openReports,
      },
      paymentOperations: {
        pendingRefunds,
        overdueRefunds,
        failedRefunds,
      },
      systemOperations: {
        failedNotifications,
        failedContractWebhooks,
        failedContractSafetyRechecks,
      },
      totalPending:
        pendingBrokers + pendingProperties + openReports + pendingRefunds,
      urgentCount,
      generatedAt: now.toISOString(),
    };
  }
}
