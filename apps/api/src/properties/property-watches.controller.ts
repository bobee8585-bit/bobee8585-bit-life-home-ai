import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { UpdatePropertyWatchDto } from './dto/update-property-watch.dto';
import { PropertyWatchesService } from './property-watches.service';

@Permissions('PROPERTY.WATCH')
@Controller()
export class PropertyWatchesController {
  constructor(private readonly watches: PropertyWatchesService) {}

  @MenuAccess('PROPERTY_FAVORITES', 'read')
  @Get('property-watches')
  list(@Req() request: AuthenticatedRequest) {
    return this.watches.list(request.auth.sub);
  }

  @MenuAccess('PROPERTY_FAVORITES', 'read')
  @Get('property-watches/:id/changes')
  changes(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.watches.changes(request.auth.sub, id);
  }

  @MenuAccess('PROPERTY_FAVORITES', 'write')
  @Post('properties/:propertyId/watch')
  create(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.watches.create(request.auth.sub, propertyId);
  }

  @MenuAccess('PROPERTY_FAVORITES', 'write')
  @Patch('property-watches/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyWatchDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.watches.update(request.auth.sub, id, dto);
  }

  @MenuAccess('PROPERTY_FAVORITES', 'write')
  @Delete('property-watches/:id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.watches.remove(request.auth.sub, id);
  }
}
