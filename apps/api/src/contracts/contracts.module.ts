import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContractProviderService } from './contract-provider.service';
import { ContractSafetyProviderService } from './contract-safety-provider.service';
import { ContractSafetyRecheckService } from './contract-safety-recheck.service';
import { ContractWebhookController } from './contract-webhook.controller';
import { ContractWebhookService } from './contract-webhook.service';
import { ElectronicContractController } from './electronic-contract.controller';
import { ElectronicContractService } from './electronic-contract.service';

@Module({
  imports: [AuthModule],
  controllers: [ElectronicContractController, ContractWebhookController],
  providers: [
    ContractProviderService,
    ContractSafetyProviderService,
    ContractSafetyRecheckService,
    ContractWebhookService,
    ElectronicContractService,
  ],
})
export class ContractsModule {}
