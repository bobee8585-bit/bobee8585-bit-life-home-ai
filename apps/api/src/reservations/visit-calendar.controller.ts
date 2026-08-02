import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { VisitCalendarQueryDto } from './dto/visit-calendar-query.dto';
import { VisitCalendarService } from './visit-calendar.service';

@Controller('visit-calendar')
export class VisitCalendarController {
  constructor(private readonly calendar: VisitCalendarService) {}

  @Permissions('RESERVATION.RESPOND')
  @MenuAccess('VISIT_CALENDAR', 'read')
  @Get()
  get(@Req() req: AuthenticatedRequest, @Query() query: VisitCalendarQueryDto) { return this.calendar.get(req.auth.sub, query); }
}
