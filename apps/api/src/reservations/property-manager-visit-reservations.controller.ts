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
import { ListVisitReservationsDto } from './dto/list-visit-reservations.dto';
import { ProposeAlternativeDto } from './dto/propose-alternative.dto';
import {
  ApproveVisitReservationDto,
  ReservationReasonDto,
} from './dto/reservation-response.dto';
import { VisitReservationsService } from './visit-reservations.service';

@Permissions('RESERVATION.MANAGE_OWN_LISTING')
@MenuAccess('PROPERTY_OWNER_RESERVATION_MANAGE', 'read')
@Controller('property-manager/visit-reservations')
export class PropertyManagerVisitReservationsController {
  constructor(private readonly reservations: VisitReservationsService) {}

  @Get()
  list(
    @Query() query: ListVisitReservationsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.brokerList(request.auth.sub, query);
  }

  @MenuAccess('PROPERTY_OWNER_RESERVATION_MANAGE', 'write')
  @Post(':reservationId/approve')
  approve(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: ApproveVisitReservationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.approve(
      request.auth.sub,
      reservationId,
      dto.message,
    );
  }

  @MenuAccess('PROPERTY_OWNER_RESERVATION_MANAGE', 'write')
  @Post(':reservationId/reject')
  reject(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: ReservationReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.reject(
      request.auth.sub,
      reservationId,
      dto.reason,
    );
  }

  @MenuAccess('PROPERTY_OWNER_RESERVATION_MANAGE', 'write')
  @Post(':reservationId/alternative')
  proposeAlternative(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: ProposeAlternativeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reservations.proposeAlternative(
      request.auth.sub,
      reservationId,
      dto,
    );
  }
}
