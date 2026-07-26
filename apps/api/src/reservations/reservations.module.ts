import { Module } from '@nestjs/common';
import { BrokerVisitReservationsController } from './broker-visit-reservations.controller';
import { VisitReservationsController } from './visit-reservations.controller';
import { VisitReservationsService } from './visit-reservations.service';
import { VisitRoutePlannerService } from './visit-route-planner.service';
import { PaymentsModule } from '../payments/payments.module';
import { PropertyManagerVisitReservationsController } from './property-manager-visit-reservations.controller';
import { MapRouteProviderService } from './map-route-provider.service';

@Module({
  imports: [PaymentsModule],
  controllers: [
    VisitReservationsController,
    BrokerVisitReservationsController,
    PropertyManagerVisitReservationsController,
  ],
  providers: [
    VisitReservationsService,
    VisitRoutePlannerService,
    MapRouteProviderService,
  ],
})
export class ReservationsModule {}
