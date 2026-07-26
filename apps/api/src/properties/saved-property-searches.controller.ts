import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { MenuAccess } from '../feature-policy/menu-access.decorator';
import { CreateSavedPropertySearchDto } from './dto/create-saved-property-search.dto';
import { UpdateSavedPropertySearchDto } from './dto/update-saved-property-search.dto';
import { SavedPropertySearchesService } from './saved-property-searches.service';

@Permissions('PROPERTY.SEARCH_SAVE')
@Controller('saved-property-searches')
export class SavedPropertySearchesController {
  constructor(private readonly searches: SavedPropertySearchesService) {}

  @MenuAccess('SAVED_PROPERTY_SEARCH', 'read') @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.searches.list(request.auth.sub);
  }

  @MenuAccess('SAVED_PROPERTY_SEARCH', 'write') @Post()
  create(@Body() dto: CreateSavedPropertySearchDto, @Req() request: AuthenticatedRequest) {
    return this.searches.create(request.auth.sub, dto);
  }

  @MenuAccess('SAVED_PROPERTY_SEARCH', 'write') @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSavedPropertySearchDto,
    @Req() request: AuthenticatedRequest) {
    return this.searches.update(request.auth.sub, id, dto);
  }

  @MenuAccess('SAVED_PROPERTY_SEARCH', 'write') @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.searches.remove(request.auth.sub, id);
  }
}
