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
import { CreateElectronicContractDto } from './dto/create-electronic-contract.dto';
import { ListElectronicContractsDto } from './dto/list-electronic-contracts.dto';
import { ContractSafetyRecheckService } from './contract-safety-recheck.service';
import { ElectronicContractService } from './electronic-contract.service';

@Permissions('CONTRACT.READ')
@MenuAccess('ELECTRONIC_CONTRACT')
@Controller()
export class ElectronicContractController {
  constructor(
    private readonly contracts: ElectronicContractService,
    private readonly safetyRechecks: ContractSafetyRecheckService,
  ) {}

  @Permissions('CONTRACT.MANAGE')
  @MenuAccess('ELECTRONIC_CONTRACT', 'write')
  @Post('visit-reservations/:reservationId/contracts')
  create(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() dto: CreateElectronicContractDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contracts.create(request.auth.sub, reservationId, dto);
  }

  @Get('contracts')
  list(
    @Query() query: ListElectronicContractsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contracts.list(request.auth.sub, query);
  }

  @Get('contracts/:contractId')
  get(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contracts.get(request.auth.sub, contractId);
  }

  @Get('contracts/:contractId/safety-recheck')
  latestSafetyRecheck(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.safetyRechecks.latest(request.auth.sub, contractId);
  }

  @Permissions('CONTRACT.MANAGE')
  @MenuAccess('ELECTRONIC_CONTRACT', 'write')
  @Post('contracts/:contractId/safety-recheck')
  runSafetyRecheck(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.safetyRechecks.run(request.auth.sub, contractId, {
      force: true,
    });
  }

  @Permissions('CONTRACT.MANAGE')
  @MenuAccess('ELECTRONIC_CONTRACT', 'write')
  @Post('contracts/:contractId/signing-session')
  startSigning(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contracts.startSigning(request.auth.sub, contractId);
  }
}
