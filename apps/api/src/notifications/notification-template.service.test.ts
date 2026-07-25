import { describe, expect, it } from 'vitest';
import { NotificationTemplateService } from './notification-template.service';

describe('NotificationTemplateService', () => {
  const service = new NotificationTemplateService();

  it('renders a reservation approval without exposing arbitrary payload data', () => {
    const result = service.render(
      'VISIT_RESERVATION_APPROVED',
      'VisitReservation',
      '019c75df-0255-7000-8000-000000000501',
      {
        reservationNumber: 'VR-2026-TEST',
        startAt: '2026-07-26T01:00:00.000Z',
        secret: 'must-not-leak',
      },
    );

    expect(result.title).toBe('방문 예약이 확정됐어요');
    expect(result.body).toContain('VR-2026-TEST');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(result.data.aggregateId).toBe(
      '019c75df-0255-7000-8000-000000000501',
    );
  });

  it('uses a safe generic template for a newly introduced event', () => {
    expect(
      service.render('UNKNOWN_EVENT', 'Unknown', 'aggregate', {}),
    ).toEqual({
      title: 'LIFE HOME AI 알림',
      body: '새로운 알림이 도착했습니다.',
      data: {
        notificationType: 'UNKNOWN_EVENT',
        aggregateType: 'Unknown',
        aggregateId: 'aggregate',
      },
    });
  });

  it('renders chat notification metadata without copying message text', () => {
    const result = service.render(
      'CHAT_MESSAGE_RECEIVED',
      'PropertyChatRoom',
      '019c75df-0255-7000-8000-000000000601',
      {
        listingNumber: 'LH-2026-CHAT',
        messageBody: '알림에 노출되면 안 되는 대화 내용',
      },
    );

    expect(result.title).toBe('새 매물 채팅 메시지');
    expect(result.body).toContain('LH-2026-CHAT');
    expect(JSON.stringify(result)).not.toContain('노출되면 안 되는');
  });
});
