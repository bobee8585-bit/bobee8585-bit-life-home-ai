import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { AdminPaymentsService } from './admin-payments.service';
import { ListAdminPaymentsDto } from './dto/list-admin-payments.dto';

@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  @Permissions('PAYMENT.READ')
  @MenuAccess('ADMIN_PAYMENT_OPERATIONS', 'read')
  @Get()
  list(@Query() query: ListAdminPaymentsDto) {
    return this.payments.list(query);
  }

  @Permissions('PAYMENT.READ')
  @MenuAccess('ADMIN_PAYMENT_OPERATIONS', 'read')
  @Get('summary')
  summary() {
    return this.payments.summary();
  }

  @Permissions('PAYMENT.READ')
  @MenuAccess('ADMIN_PAYMENT_OPERATIONS', 'read')
  @Get(':depositId')
  get(@Param('depositId', ParseUUIDPipe) depositId: string) {
    return this.payments.get(depositId);
  }

  @Permissions('PAYMENT.REFUND')
  @MenuAccess('ADMIN_PAYMENT_OPERATIONS', 'write')
  @Post(':depositId/refund/retry')
  retry(
    @Param('depositId', ParseUUIDPipe) depositId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.retryRefund(
      depositId,
      request.auth.sub,
      idempotencyKey ?? '',
    );
  }
}
