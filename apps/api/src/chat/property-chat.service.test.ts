import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  ChatMessageType,
  PropertyStatus,
} from '../generated/prisma/client';
import { PropertyChatService } from './property-chat.service';

const room = {
  id: '019c75df-0255-7000-8000-000000000601',
  propertyId: '019c75df-0255-7000-8000-000000000602',
  memberUserId: '019c75df-0255-7000-8000-000000000603',
  registrantUserId: '019c75df-0255-7000-8000-000000000604',
  lastMessageSequence: 3,
  memberLastReadSequence: 3,
  registrantLastReadSequence: 1,
  lastMessageAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  property: {
    status: PropertyStatus.ACTIVE,
    listingNumber: 'LH-2026-CHAT',
  },
};

const message = {
  id: '019c75df-0255-7000-8000-000000000605',
  chatRoomId: room.id,
  senderUserId: room.memberUserId,
  clientMessageId: '019c75df-0255-7000-8000-000000000606',
  sequence: 4,
  type: ChatMessageType.TEXT,
  body: '매물 방문이 가능한가요?',
  createdAt: new Date(),
};

describe('PropertyChatService', () => {
  it('does not allow a registrant to open a chat with their own property', async () => {
    const prisma = {
      property: {
        findFirst: vi.fn(async () => ({
          id: room.propertyId,
          brokerUserId: room.memberUserId,
          listingNumber: 'LH-SELF',
        })),
      },
    } as unknown as PrismaService;

    await expect(
      new PropertyChatService(prisma).createRoom(
        room.memberUserId,
        room.propertyId,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('hides a room from non-participants', async () => {
    const prisma = {
      propertyChatRoom: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;

    await expect(
      new PropertyChatService(prisma).listMessages(
        '019c75df-0255-7000-8000-000000000699',
        room.id,
        { limit: 50 },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('blocks new messages after the property is no longer active', async () => {
    const prisma = {
      propertyChatRoom: {
        findFirst: vi.fn(async () => ({
          ...room,
          property: {
            ...room.property,
            status: PropertyStatus.INACTIVE,
          },
        })),
      },
    } as unknown as PrismaService;

    await expect(
      new PropertyChatService(prisma).sendMessage(
        room.memberUserId,
        room.id,
        {
          clientMessageId: message.clientMessageId,
          body: message.body,
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('returns an identical retry without creating a duplicate message', async () => {
    const transaction = vi.fn();
    const prisma = {
      propertyChatRoom: { findFirst: vi.fn(async () => room) },
      chatMessage: { findUnique: vi.fn(async () => message) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const result = await new PropertyChatService(prisma).sendMessage(
      room.memberUserId,
      room.id,
      {
        clientMessageId: message.clientMessageId,
        body: `  ${message.body}  `,
      },
    );

    expect(result.sequence).toBe(4);
    expect(result.body).toBe(message.body);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects different content that reuses a message id', async () => {
    const prisma = {
      propertyChatRoom: { findFirst: vi.fn(async () => room) },
      chatMessage: { findUnique: vi.fn(async () => message) },
    } as unknown as PrismaService;

    await expect(
      new PropertyChatService(prisma).sendMessage(
        room.memberUserId,
        room.id,
        {
          clientMessageId: message.clientMessageId,
          body: '같은 ID의 다른 메시지',
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('stores a sequenced message and queues a body-free notification', async () => {
    const tx = {
      propertyChatRoom: {
        findFirst: vi.fn(async () => room),
        update: vi
          .fn()
          .mockResolvedValueOnce({ lastMessageSequence: 4 })
          .mockResolvedValueOnce({}),
      },
      chatMessage: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => message),
      },
      notificationOutbox: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      propertyChatRoom: { findFirst: vi.fn(async () => room) },
      chatMessage: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
    } as unknown as PrismaService;

    const result = await new PropertyChatService(prisma).sendMessage(
      room.memberUserId,
      room.id,
      {
        clientMessageId: message.clientMessageId,
        body: message.body,
      },
    );

    expect(result.sequence).toBe(4);
    const notification = tx.notificationOutbox.create.mock.calls[0]?.[0];
    expect(notification?.data.recipientUserId).toBe(room.registrantUserId);
    expect(JSON.stringify(notification)).not.toContain(message.body);
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('cannot mark a sequence that does not exist as read', async () => {
    const prisma = {
      propertyChatRoom: { findFirst: vi.fn(async () => room) },
    } as unknown as PrismaService;

    await expect(
      new PropertyChatService(prisma).markRead(
        room.memberUserId,
        room.id,
        room.lastMessageSequence + 1,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
