import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { ConfirmReservationDepositDto } from './dto/confirm-reservation-deposit.dto';
import { PrepareReservationDepositDto } from './dto/prepare-reservation-deposit.dto';
import { ReservationDepositService } from './reservation-deposit.service';

@Permissions('RESERVATION.RESPOND')
@MenuAccess('PROPERTY_RESERVATIONS', 'read')
@Controller('visit-reservations/:reservationId/deposit')
export class ReservationDepositController {
  constructor(private readonly deposits: ReservationDepositService) {}

  @Get()
  get(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deposits.get(request.auth.sub, reservationId);
  }

  @MenuAccess('PROPERTY_RESERVATIONS', 'write')
  @Post('prepare')
  prepare(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() _dto: PrepareReservationDepositDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deposits.prepare(
      request.auth.sub,
      reservationId,
      this.requireKey(idempotencyKey),
    );
  }

  @MenuAccess('PROPERTY_RESERVATIONS', 'write')
  @Post('confirm')
  confirm(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ConfirmReservationDepositDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deposits.confirm(request.auth.sub, reservationId, {
      paymentKey: dto.paymentKey,
      kcpEncData: dto.kcpEncData,
      kcpEncInfo: dto.kcpEncInfo,
      kcpPayType: dto.kcpPayType,
      amount: dto.amount,
      currency: dto.currency,
      idempotencyKey: this.requireKey(idempotencyKey),
    });
  }

  private requireKey(value: string | undefined): string {
    if (!value) {
      throw new BadRequestException('Idempotency-Key 헤더가 필요합니다.');
    }
    return value;
  }
}
