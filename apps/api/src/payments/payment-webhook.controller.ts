import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RawResponse } from '../common/raw-response.decorator';
import { PaymentWebhookService } from './payment-webhook.service';

@Public()
@Controller('payment-webhooks')
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post('toss')
  @HttpCode(200)
  toss(
    @Headers('tosspayments-webhook-transmission-id')
    transmissionId: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.webhooks.handle('TOSS', transmissionId, payload);
  }

  @Post('nicepay')
  @HttpCode(200)
  nicepay(
    @Headers('x-nicepay-transmission-id')
    transmissionId: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.webhooks.handle('NICEPAY', transmissionId, payload);
  }

  @Post('nhn-kcp')
  @HttpCode(200)
  @RawResponse()
  async nhnKcp(
    @Headers('x-kcp-transmission-id')
    transmissionId: string | undefined,
    @Body() payload: unknown,
  ) {
    await this.webhooks.handle('NHN_KCP', transmissionId, payload);
    return { result: '0000' };
  }
}
