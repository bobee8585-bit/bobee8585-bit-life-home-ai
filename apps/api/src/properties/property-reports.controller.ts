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
import { CreatePropertyReportDto } from './dto/create-property-report.dto';
import { ListPropertyReportsDto } from './dto/list-property-reports.dto';
import { ReviewPropertyReportDto } from './dto/review-property-report.dto';
import { PropertyReportsService } from './property-reports.service';

@Controller()
export class PropertyReportsController {
  constructor(private readonly reports: PropertyReportsService) {}

  @Permissions('PROPERTY.REPORT')
  @MenuAccess('PROPERTY_REPORT', 'write')
  @Post('properties/:propertyId/reports')
  create(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreatePropertyReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.create(request.auth.sub, propertyId, dto);
  }

  @Permissions('PROPERTY.REPORT')
  @MenuAccess('PROPERTY_REPORT', 'read')
  @Get('property-reports/mine')
  mine(@Req() request: AuthenticatedRequest) {
    return this.reports.mine(request.auth.sub);
  }

  @Permissions('PROPERTY.REPORT.REVIEW')
  @MenuAccess('PROPERTY_REPORT_REVIEW', 'read')
  @Get('admin/property-reports')
  list(@Query() query: ListPropertyReportsDto) {
    return this.reports.list(query);
  }

  @Permissions('PROPERTY.REPORT.REVIEW')
  @MenuAccess('PROPERTY_REPORT_REVIEW', 'write')
  @Post('admin/property-reports/:reportId/review')
  review(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: ReviewPropertyReportDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.review(reportId, request.auth.sub, dto);
  }
}
