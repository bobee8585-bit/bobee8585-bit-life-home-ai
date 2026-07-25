import { Module } from '@nestjs/common';
import { PaymentProviderService } from './payment-provider.service';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { ReservationDepositController } from './reservation-deposit.controller';
import { ReservationDepositService } from './reservation-deposit.service';

@Module({
  controllers: [ReservationDepositController, PaymentWebhookController],
  providers: [
    PaymentProviderService,
    PaymentWebhookService,
    ReservationDepositService,
  ],
  exports: [ReservationDepositService],
})
export class PaymentsModule {}
