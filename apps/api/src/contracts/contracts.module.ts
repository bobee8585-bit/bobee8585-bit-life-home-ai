import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContractProviderService } from './contract-provider.service';
import { ContractWebhookController } from './contract-webhook.controller';
import { ContractWebhookService } from './contract-webhook.service';
import { ElectronicContractController } from './electronic-contract.controller';
import { ElectronicContractService } from './electronic-contract.service';

@Module({
  imports: [AuthModule],
  controllers: [ElectronicContractController, ContractWebhookController],
  providers: [
    ContractProviderService,
    ContractWebhookService,
    ElectronicContractService,
  ],
})
export class ContractsModule {}
