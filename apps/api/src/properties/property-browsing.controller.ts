import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { RecordRecentSearchDto } from './dto/record-recent-search.dto';
import { PropertyBrowsingService } from './property-browsing.service';

@Controller()
@Permissions('PROPERTY.BROWSE_HISTORY')
@MenuAccess('PROPERTY_BROWSING_HISTORY', 'read')
export class PropertyBrowsingController {
  constructor(private readonly browsing: PropertyBrowsingService) {}

  @Post('properties/:propertyId/recent-view')
  recordView(@Param('propertyId', ParseUUIDPipe) propertyId: string, @Req() req: AuthenticatedRequest) {
    return this.browsing.recordView(req.auth.sub, propertyId);
  }

  @Get('property-browsing/recent-views')
  views(@Req() req: AuthenticatedRequest) { return this.browsing.views(req.auth.sub); }

  @Delete('property-browsing/recent-views')
  clearViews(@Req() req: AuthenticatedRequest, @Query('propertyId') propertyId?: string) { return this.browsing.clearViews(req.auth.sub, propertyId); }

  @Post('property-browsing/recent-searches')
  recordSearch(@Req() req: AuthenticatedRequest, @Body() dto: RecordRecentSearchDto) { return this.browsing.recordSearch(req.auth.sub, dto.criteria); }

  @Get('property-browsing/recent-searches')
  searches(@Req() req: AuthenticatedRequest) { return this.browsing.searches(req.auth.sub); }

  @Delete('property-browsing/recent-searches')
  clearSearches(@Req() req: AuthenticatedRequest, @Query('id') id?: string) { return this.browsing.clearSearches(req.auth.sub, id); }

  @Get('property-browsing/continue')
  continuation(@Req() req: AuthenticatedRequest) { return this.browsing.continue(req.auth.sub); }
}
