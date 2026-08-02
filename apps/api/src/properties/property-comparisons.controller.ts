import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { AddPropertyComparisonDto } from './dto/add-property-comparison.dto';
import { PropertyComparisonQueryDto } from './dto/property-comparison-query.dto';
import { PropertyComparisonsService } from './property-comparisons.service';

@Controller('property-comparisons')
@Permissions('PROPERTY.COMPARE')
@MenuAccess('PROPERTY_COMPARISON', 'read')
export class PropertyComparisonsController {
  constructor(private readonly comparisons: PropertyComparisonsService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest, @Query() query: PropertyComparisonQueryDto) { return this.comparisons.get(req.auth.sub, query.displayCurrency); }

  @Post()
  add(@Req() req: AuthenticatedRequest, @Body() dto: AddPropertyComparisonDto) { return this.comparisons.add(req.auth.sub, dto.propertyId, dto.replacePropertyId); }

  @Delete()
  clear(@Req() req: AuthenticatedRequest) { return this.comparisons.remove(req.auth.sub); }

  @Delete(':propertyId')
  remove(@Req() req: AuthenticatedRequest, @Param('propertyId', ParseUUIDPipe) propertyId: string) { return this.comparisons.remove(req.auth.sub, propertyId); }
}
