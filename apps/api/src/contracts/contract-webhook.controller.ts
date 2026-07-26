import {
  Body,
  Controller,
  Headers,
  Param,
  ParseEnumPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { ElectronicContractProvider } from '../generated/prisma/client';
import { ContractWebhookService } from './contract-webhook.service';

@Public()
@Controller('contract-webhooks')
export class ContractWebhookController {
  constructor(private readonly webhooks: ContractWebhookService) {}

  @Post(':provider')
  handle(
    @Param('provider', new ParseEnumPipe(ElectronicContractProvider))
    provider: ElectronicContractProvider,
    @Headers('x-contract-event-id') transmissionId: string | undefined,
    @Headers('x-contract-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    return this.webhooks.handle(
      provider,
      transmissionId,
      signature,
      request.rawBody,
      body,
    );
  }
}
