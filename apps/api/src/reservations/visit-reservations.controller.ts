import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { CreateVisitReservationDto } from './dto/create-visit-reservation.dto';
import { ListVisitReservationsDto } from './dto/list-visit-reservations.dto';
import { ReservationReasonDto } from './dto/reservation-response.dto';
import { VisitReservationsService } from './visit-reservations.service';

@Controller()
export class VisitReservationsController {
  constructor(private readonly reservations: VisitReservationsService) {}

  @Permissions('RESERVATION.CREATE')
  @MenuAccess('PROPERTY_RESERVATIONS', 'write')
  @Post('properties/:propertyId/visit-reservations')
  create(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateVisitReservationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.create(request.auth.sub, propertyId, dto);
  }

  @Permissions('RESERVATION.RESPOND')
  @MenuAccess('PROPERTY_RESERVATIONS', 'read')
  @Get('visit-reservations/mine')
  mine(
    @Query() query: ListVisitReservationsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.mine(request.auth.sub, query);
  }

  @Permissions('RESERVATION.RESPOND')
  @MenuAccess('PROPERTY_RESERVATIONS', 'write')
  @Post('visit-reservations/:reservationId/cancel')
  cancel(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: ReservationReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.cancel(
      request.auth.sub,
      reservationId,
      dto.reason,
    );
  }

  @Permissions('RESERVATION.RESPOND')
  @MenuAccess('PROPERTY_RESERVATIONS', 'write')
  @Post('visit-reservations/:reservationId/alternative/accept')
  acceptAlternative(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.acceptAlternative(
      request.auth.sub,
      reservationId,
    );
  }

  @Permissions('RESERVATION.RESPOND')
  @MenuAccess('PROPERTY_RESERVATIONS', 'write')
  @Post('visit-reservations/:reservationId/alternative/decline')
  declineAlternative(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: ReservationReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.declineAlternative(
      request.auth.sub,
      reservationId,
      dto.reason,
    );
  }
}
