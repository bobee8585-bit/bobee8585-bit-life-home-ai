import { Module } from '@nestjs/common';
import { PaymentProviderService } from './payment-provider.service';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { ReservationDepositController } from './reservation-deposit.controller';
import { ReservationDepositService } from './reservation-deposit.service';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminPaymentsService } from './admin-payments.service';

@Module({
  controllers: [
    ReservationDepositController,
    PaymentWebhookController,
    AdminPaymentsController,
  ],
  providers: [
    AdminPaymentsService,
    PaymentProviderService,
    PaymentWebhookService,
    ReservationDepositService,
  ],
  exports: [ReservationDepositService],
})
export class PaymentsModule {}
