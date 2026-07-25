import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createId } from '../common/id';
import { PrismaService } from '../database/prisma.service';
import {
  ChatMessageType,
  OwnershipVerificationStatus,
  Prisma,
  PropertyListingType,
  PropertyStatus,
} from '../generated/prisma/client';
import type { ListChatMessagesDto } from './dto/list-chat-messages.dto';
import type { ListChatRoomsDto } from './dto/list-chat-rooms.dto';
import type { SendChatMessageDto } from './dto/send-chat-message.dto';

const roomInclude = {
  property: {
    select: {
      id: true,
      listingNumber: true,
      title: true,
      status: true,
      city: true,
      listingType: true,
    },
  },
  member: {
    select: {
      memberNumber: true,
      profile: { select: { displayName: true } },
    },
  },
  registrant: {
    select: {
      memberNumber: true,
      profile: { select: { displayName: true } },
    },
  },
  messages: {
    orderBy: { sequence: 'desc' as const },
    take: 1,
    select: {
      id: true,
      senderUserId: true,
      clientMessageId: true,
      sequence: true,
      type: true,
      body: true,
      createdAt: true,
    },
  },
} as const;

type ChatRoomViewInput = Prisma.PropertyChatRoomGetPayload<{
  include: typeof roomInclude;
}>;

type MessageViewInput = {
  id: string;
  senderUserId: string;
  clientMessageId: string;
  sequence: number;
  type: ChatMessageType;
  body: string;
  createdAt: Date;
};

@Injectable()
export class PropertyChatService {
  constructor(private readonly prisma: PrismaService) {}

  async createRoom(memberUserId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: {
        id: propertyId,
        status: PropertyStatus.ACTIVE,
        OR: [
          { listingType: PropertyListingType.BROKERAGE },
          {
            listingType: PropertyListingType.OWNER_DIRECT,
            ownershipVerification: {
              status: OwnershipVerificationStatus.VERIFIED,
            },
          },
        ],
      },
      select: {
        id: true,
        brokerUserId: true,
        listingNumber: true,
      },
    });
    if (!property) {
      throw new NotFoundException('공개 중인 매물을 찾을 수 없습니다.');
    }
    if (property.brokerUserId === memberUserId) {
      throw new ForbiddenException('본인 매물에는 채팅을 시작할 수 없습니다.');
    }

    const existing = await this.prisma.propertyChatRoom.findUnique({
      where: { propertyId_memberUserId: { propertyId, memberUserId } },
      select: { id: true },
    });
    if (existing) {
      return this.getRoom(memberUserId, existing.id);
    }

    const id = createId();
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.propertyChatRoom.create({
          data: {
            id,
            propertyId,
            memberUserId,
            registrantUserId: property.brokerUserId,
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: memberUserId,
            action: 'PROPERTY_CHAT_ROOM.CREATE',
            targetType: 'PropertyChatRoom',
            targetId: id,
            afterData: {
              propertyId,
              listingNumber: property.listingNumber,
              registrantUserId: property.brokerUserId,
            },
          },
        });
      });
      return this.getRoom(memberUserId, id);
    } catch (error: unknown) {
      if (this.prismaCode(error) !== 'P2002') {
        throw error;
      }
      const concurrent = await this.prisma.propertyChatRoom.findUnique({
        where: { propertyId_memberUserId: { propertyId, memberUserId } },
        select: { id: true },
      });
      if (!concurrent) {
        throw error;
      }
      return this.getRoom(memberUserId, concurrent.id);
    }
  }

  async listRooms(userId: string, query: ListChatRoomsDto) {
    const where = {
      OR: [{ memberUserId: userId }, { registrantUserId: userId }],
    };
    const [rooms, total] = await this.prisma.$transaction([
      this.prisma.propertyChatRoom.findMany({
        where,
        include: roomInclude,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.propertyChatRoom.count({ where }),
    ]);
    return {
      items: rooms.map((room) => this.roomView(room, userId)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async listMessages(
    userId: string,
    chatRoomId: string,
    query: ListChatMessagesDto,
  ) {
    const room = await this.roomForParticipant(chatRoomId, userId);
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        chatRoomId,
        ...(query.beforeSequence
          ? { sequence: { lt: query.beforeSequence } }
          : {}),
      },
      orderBy: { sequence: 'desc' },
      take: query.limit,
    });
    const items = messages
      .map((message) => this.messageView(message, room))
      .reverse();
    const oldestSequence = messages.at(-1)?.sequence ?? null;
    return {
      items,
      nextBeforeSequence:
        oldestSequence !== null && oldestSequence > 1
          ? oldestSequence
          : null,
      hasMore: oldestSequence !== null && oldestSequence > 1,
    };
  }

  async sendMessage(
    senderUserId: string,
    chatRoomId: string,
    dto: SendChatMessageDto,
  ) {
    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException('공백만 있는 메시지는 보낼 수 없습니다.');
    }

    const room = await this.roomForParticipant(chatRoomId, senderUserId);
    this.assertWritable(room);
    const existing = await this.findIdempotentMessage(
      chatRoomId,
      senderUserId,
      dto.clientMessageId,
    );
    if (existing) {
      this.assertSameMessage(existing.body, body);
      return this.messageView(existing, room);
    }

    const now = new Date();
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.propertyChatRoom.findFirst({
          where: {
            id: chatRoomId,
            OR: [
              { memberUserId: senderUserId },
              { registrantUserId: senderUserId },
            ],
          },
          include: {
            property: {
              select: {
                status: true,
                listingNumber: true,
              },
            },
          },
        });
        if (!current) {
          throw new NotFoundException('채팅방을 찾을 수 없습니다.');
        }
        if (current.property.status !== PropertyStatus.ACTIVE) {
          throw new ConflictException(
            '거래가 종료되거나 비공개된 매물에는 새 메시지를 보낼 수 없습니다.',
          );
        }
        const duplicate = await transaction.chatMessage.findUnique({
          where: {
            chatRoomId_senderUserId_clientMessageId: {
              chatRoomId,
              senderUserId,
              clientMessageId: dto.clientMessageId,
            },
          },
        });
        if (duplicate) {
          this.assertSameMessage(duplicate.body, body);
          return duplicate;
        }

        const advanced = await transaction.propertyChatRoom.update({
          where: { id: chatRoomId },
          data: {
            lastMessageSequence: { increment: 1 },
            lastMessageAt: now,
          },
          select: { lastMessageSequence: true },
        });
        const sequence = advanced.lastMessageSequence;
        const message = await transaction.chatMessage.create({
          data: {
            id: createId(),
            chatRoomId,
            senderUserId,
            clientMessageId: dto.clientMessageId,
            sequence,
            type: ChatMessageType.TEXT,
            body,
            createdAt: now,
          },
        });
        await transaction.propertyChatRoom.update({
          where: { id: chatRoomId },
          data:
            senderUserId === current.memberUserId
              ? { memberLastReadSequence: sequence }
              : { registrantLastReadSequence: sequence },
        });
        const recipientUserId =
          senderUserId === current.memberUserId
            ? current.registrantUserId
            : current.memberUserId;
        await transaction.notificationOutbox.create({
          data: {
            id: createId(),
            recipientUserId,
            type: 'CHAT_MESSAGE_RECEIVED',
            aggregateType: 'PropertyChatRoom',
            aggregateId: chatRoomId,
            smsFallbackAllowed: false,
            payload: {
              chatRoomId,
              listingNumber: current.property.listingNumber,
              sequence,
              senderRole:
                senderUserId === current.memberUserId
                  ? 'MEMBER'
                  : 'REGISTRANT',
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            id: createId(),
            actorId: senderUserId,
            action: 'PROPERTY_CHAT_MESSAGE.SEND',
            targetType: 'ChatMessage',
            targetId: message.id,
            afterData: {
              chatRoomId,
              sequence,
              type: ChatMessageType.TEXT,
            },
          },
        });
        return message;
      });
      return this.messageView(result, {
        ...room,
        ...(senderUserId === room.memberUserId
          ? { memberLastReadSequence: result.sequence }
          : { registrantLastReadSequence: result.sequence }),
      });
    } catch (error: unknown) {
      if (this.prismaCode(error) !== 'P2002') {
        throw error;
      }
      const concurrent = await this.findIdempotentMessage(
        chatRoomId,
        senderUserId,
        dto.clientMessageId,
      );
      if (!concurrent) {
        throw error;
      }
      this.assertSameMessage(concurrent.body, body);
      return this.messageView(concurrent, room);
    }
  }

  async markRead(
    userId: string,
    chatRoomId: string,
    throughSequence: number,
  ) {
    const room = await this.roomForParticipant(chatRoomId, userId);
    if (throughSequence > room.lastMessageSequence) {
      throw new BadRequestException(
        '아직 존재하지 않는 메시지까지 읽음 처리할 수 없습니다.',
      );
    }
    const currentRead =
      userId === room.memberUserId
        ? room.memberLastReadSequence
        : room.registrantLastReadSequence;
    if (throughSequence > currentRead) {
      const changed = await this.prisma.propertyChatRoom.updateMany({
        where:
          userId === room.memberUserId
            ? {
                id: chatRoomId,
                memberUserId: userId,
                memberLastReadSequence: { lt: throughSequence },
              }
            : {
                id: chatRoomId,
                registrantUserId: userId,
                registrantLastReadSequence: { lt: throughSequence },
              },
        data:
          userId === room.memberUserId
            ? { memberLastReadSequence: throughSequence }
            : { registrantLastReadSequence: throughSequence },
      });
      if (changed.count === 0) {
        const refreshed = await this.roomForParticipant(chatRoomId, userId);
        const refreshedRead =
          userId === refreshed.memberUserId
            ? refreshed.memberLastReadSequence
            : refreshed.registrantLastReadSequence;
        return {
          chatRoomId,
          lastReadSequence: refreshedRead,
          unreadCount: refreshed.lastMessageSequence - refreshedRead,
        };
      }
    }
    return {
      chatRoomId,
      lastReadSequence: Math.max(currentRead, throughSequence),
      unreadCount:
        room.lastMessageSequence - Math.max(currentRead, throughSequence),
    };
  }

  private async getRoom(userId: string, chatRoomId: string) {
    const room = await this.prisma.propertyChatRoom.findFirst({
      where: {
        id: chatRoomId,
        OR: [{ memberUserId: userId }, { registrantUserId: userId }],
      },
      include: roomInclude,
    });
    if (!room) {
      throw new NotFoundException('채팅방을 찾을 수 없습니다.');
    }
    return this.roomView(room, userId);
  }

  private async roomForParticipant(chatRoomId: string, userId: string) {
    const room = await this.prisma.propertyChatRoom.findFirst({
      where: {
        id: chatRoomId,
        OR: [{ memberUserId: userId }, { registrantUserId: userId }],
      },
      include: {
        property: {
          select: {
            status: true,
            listingNumber: true,
          },
        },
      },
    });
    if (!room) {
      throw new NotFoundException('채팅방을 찾을 수 없습니다.');
    }
    return room;
  }

  private roomView(room: ChatRoomViewInput, userId: string) {
    const role = this.participantRole(room, userId);
    const readSequence =
      role === 'MEMBER'
        ? room.memberLastReadSequence
        : room.registrantLastReadSequence;
    const counterpart = role === 'MEMBER' ? room.registrant : room.member;
    const latestMessage = room.messages[0];
    return {
      id: room.id,
      property: room.property,
      myRole: role,
      counterpart: {
        memberNumber: counterpart.memberNumber,
        displayName: counterpart.profile?.displayName ?? '회원',
      },
      lastMessageSequence: room.lastMessageSequence,
      lastReadSequence: readSequence,
      unreadCount: room.lastMessageSequence - readSequence,
      writable: room.property.status === PropertyStatus.ACTIVE,
      latestMessage: latestMessage
        ? this.messageView(latestMessage, room)
        : null,
      lastMessageAt: room.lastMessageAt.toISOString(),
      createdAt: room.createdAt.toISOString(),
    };
  }

  private messageView(
    message: MessageViewInput,
    room: {
      memberUserId: string;
      registrantUserId: string;
      memberLastReadSequence: number;
      registrantLastReadSequence: number;
    },
  ) {
    const senderRole =
      message.senderUserId === room.memberUserId ? 'MEMBER' : 'REGISTRANT';
    const recipientReadSequence =
      senderRole === 'MEMBER'
        ? room.registrantLastReadSequence
        : room.memberLastReadSequence;
    return {
      id: message.id,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      type: message.type,
      body: message.body,
      senderRole,
      readByRecipient: recipientReadSequence >= message.sequence,
      sentAt: message.createdAt.toISOString(),
    };
  }

  private participantRole(
    room: { memberUserId: string; registrantUserId: string },
    userId: string,
  ): 'MEMBER' | 'REGISTRANT' {
    if (room.memberUserId === userId) {
      return 'MEMBER';
    }
    if (room.registrantUserId === userId) {
      return 'REGISTRANT';
    }
    throw new NotFoundException('채팅방을 찾을 수 없습니다.');
  }

  private assertWritable(room: { property: { status: PropertyStatus } }) {
    if (room.property.status !== PropertyStatus.ACTIVE) {
      throw new ConflictException(
        '거래가 종료되거나 비공개된 매물에는 새 메시지를 보낼 수 없습니다.',
      );
    }
  }

  private findIdempotentMessage(
    chatRoomId: string,
    senderUserId: string,
    clientMessageId: string,
  ) {
    return this.prisma.chatMessage.findUnique({
      where: {
        chatRoomId_senderUserId_clientMessageId: {
          chatRoomId,
          senderUserId,
          clientMessageId,
        },
      },
    });
  }

  private assertSameMessage(previousBody: string, body: string) {
    if (previousBody !== body) {
      throw new ConflictException(
        '같은 메시지 식별자로 다른 내용을 보낼 수 없습니다.',
      );
    }
  }

  private prismaCode(error: unknown): string | undefined {
    return typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
      ? error.code
      : undefined;
  }
}
