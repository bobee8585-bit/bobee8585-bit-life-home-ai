import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
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
import { AdminDashboardService } from './admin-dashboard.service';

describe('AdminDashboardService', () => {
  it('returns operational queue counts without member or payment details', async () => {
    const counts = [2, 3, 4, 5, 1, 2, 3, 4, 5];
    let index = 0;
    const count = vi.fn(() => Promise.resolve(counts[index++]));
    const prisma = {
      brokerProfile: { count },
      property: { count },
      propertyReport: { count },
      reservationDeposit: { count },
      paymentTransaction: { count },
      notificationOutbox: { count },
      contractWebhookEvent: { count },
      contractSafetyRecheck: { count },
      $transaction: vi.fn(async (operations: Array<Promise<number>>) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;

    const result = await new AdminDashboardService(prisma).summary();

    expect(result.reviewQueues).toEqual({
      pendingBrokers: 2,
      pendingProperties: 3,
      openReports: 4,
    });
    expect(result.paymentOperations).toEqual({
      pendingRefunds: 5,
      overdueRefunds: 1,
      failedRefunds: 2,
    });
    expect(result.systemOperations).toEqual({
      failedNotifications: 3,
      failedContractWebhooks: 4,
      failedContractSafetyRechecks: 5,
    });
    expect(result.totalPending).toBe(14);
    expect(result.urgentCount).toBe(15);
    expect(JSON.stringify(result)).not.toContain('memberNumber');
  });

  it('uses only actionable states for dashboard queues', async () => {
    const brokerCount = vi.fn(async () => 0);
    const propertyCount = vi.fn(async () => 0);
    const reportCount = vi.fn(async () => 0);
    const depositCount = vi.fn(async () => 0);
    const transactionCount = vi.fn(async () => 0);
    const notificationCount = vi.fn(async () => 0);
    const webhookCount = vi.fn(async () => 0);
    const safetyRecheckCount = vi.fn(async () => 0);
    const prisma = {
      brokerProfile: { count: brokerCount },
      property: { count: propertyCount },
      propertyReport: { count: reportCount },
      reservationDeposit: { count: depositCount },
      paymentTransaction: { count: transactionCount },
      notificationOutbox: { count: notificationCount },
      contractWebhookEvent: { count: webhookCount },
      contractSafetyRecheck: { count: safetyRecheckCount },
      $transaction: vi.fn(async (operations: Array<Promise<number>>) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;

    await new AdminDashboardService(prisma).summary();

    expect(brokerCount).toHaveBeenCalledWith({
      where: { status: BrokerStatus.PENDING },
    });
    expect(propertyCount).toHaveBeenCalledWith({
      where: { status: PropertyStatus.PENDING_REVIEW },
    });
    expect(reportCount).toHaveBeenCalledWith({
      where: {
        status: {
          in: [PropertyReportStatus.OPEN, PropertyReportStatus.UNDER_REVIEW],
        },
      },
    });
    expect(depositCount).toHaveBeenCalledWith({
      where: { status: ReservationDepositStatus.REFUND_PENDING },
    });
    expect(transactionCount).toHaveBeenCalledWith({
      where: {
        type: PaymentTransactionType.REFUND,
        status: PaymentTransactionStatus.FAILED,
      },
    });
    expect(notificationCount).toHaveBeenCalledWith({
      where: { status: NotificationDeliveryStatus.FAILED },
    });
    expect(webhookCount).toHaveBeenCalledWith({
      where: { status: ContractWebhookEventStatus.FAILED },
    });
    expect(safetyRecheckCount).toHaveBeenCalledWith({
      where: { status: ContractSafetyRecheckStatus.FAILED },
    });
  });
});
