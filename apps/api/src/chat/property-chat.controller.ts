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
import { ListChatMessagesDto } from './dto/list-chat-messages.dto';
import { ListChatRoomsDto } from './dto/list-chat-rooms.dto';
import { MarkChatReadDto } from './dto/mark-chat-read.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { PropertyChatService } from './property-chat.service';

@Permissions('CHAT.USE')
@MenuAccess('PROPERTY_CHAT')
@Controller()
export class PropertyChatController {
  constructor(private readonly chats: PropertyChatService) {}

  @MenuAccess('PROPERTY_CHAT', 'write')
  @Post('properties/:propertyId/chat-rooms')
  createRoom(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chats.createRoom(request.auth.sub, propertyId);
  }

  @Get('chat-rooms')
  listRooms(
    @Query() query: ListChatRoomsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chats.listRooms(request.auth.sub, query);
  }

  @Get('chat-rooms/:chatRoomId/messages')
  listMessages(
    @Param('chatRoomId', ParseUUIDPipe) chatRoomId: string,
    @Query() query: ListChatMessagesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chats.listMessages(request.auth.sub, chatRoomId, query);
  }

  @MenuAccess('PROPERTY_CHAT', 'write')
  @Post('chat-rooms/:chatRoomId/messages')
  sendMessage(
    @Param('chatRoomId', ParseUUIDPipe) chatRoomId: string,
    @Body() dto: SendChatMessageDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chats.sendMessage(request.auth.sub, chatRoomId, dto);
  }

  @MenuAccess('PROPERTY_CHAT', 'write')
  @Post('chat-rooms/:chatRoomId/read')
  markRead(
    @Param('chatRoomId', ParseUUIDPipe) chatRoomId: string,
    @Body() dto: MarkChatReadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chats.markRead(
      request.auth.sub,
      chatRoomId,
      dto.throughSequence,
    );
  }
}
