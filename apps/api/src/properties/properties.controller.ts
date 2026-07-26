import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { CreatePropertyDto } from './dto/create-property.dto';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { PropertyDisplayDto } from './dto/property-display.dto';
import { PropertiesService } from './properties.service';
import { LeaseSafetyService } from './lease-safety.service';

@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly leaseSafety: LeaseSafetyService,
  ) {}

  @Public()
  @MenuAccess('PROPERTY_SEARCH', 'read')
  @Get()
  search(@Query() query: SearchPropertiesDto) {
    return this.properties.search(query);
  }

  @Permissions('PROPERTY.READ')
  @MenuAccess('PROPERTY_MANAGE', 'read')
  @Get('mine')
  mine(@Req() request: AuthenticatedRequest) {
    return this.properties.mine(request.auth.sub);
  }

  @Permissions('PROPERTY.CREATE')
  @MenuAccess('PROPERTY_MANAGE', 'write')
  @Post()
  create(
    @Body() dto: CreatePropertyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.properties.create(request.auth.sub, dto);
  }

  @Permissions('PROPERTY.UPDATE')
  @MenuAccess('PROPERTY_MANAGE', 'write')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePropertyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.properties.update(request.auth.sub, id, dto);
  }

  @Permissions('PROPERTY.SUBMIT')
  @MenuAccess('PROPERTY_MANAGE', 'write')
  @Post(':id/submit')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.properties.submit(request.auth.sub, id);
  }

  @Public()
  @MenuAccess('PROPERTY_SEARCH', 'read')
  @Get(':id/lease-safety')
  leaseSafetyDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.leaseSafety.latest(id);
  }

  @Public()
  @MenuAccess('PROPERTY_SEARCH', 'read')
  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PropertyDisplayDto,
  ) {
    return this.properties.detail(id, query.displayCurrency);
  }
}
