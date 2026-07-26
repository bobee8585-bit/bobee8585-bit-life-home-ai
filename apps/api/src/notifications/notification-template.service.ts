import { Injectable } from '@nestjs/common';

export type NotificationMessage = {
  title: string;
  body: string;
  data: Record<string, string>;
};

type Payload = Record<string, unknown>;

@Injectable()
export class NotificationTemplateService {
  render(
    type: string,
    aggregateType: string,
    aggregateId: string,
    rawPayload: unknown,
  ): NotificationMessage {
    const payload = this.payload(rawPayload);
    const reservationNumber = this.text(payload.reservationNumber);
    const title = this.text(payload.title);
    const startAt = this.dateTime(payload.startAt);
    const commonData = {
      notificationType: type,
      aggregateType,
      aggregateId,
    };

    switch (type) {
      case 'VISIT_RESERVATION_REQUESTED':
        return {
          title: '새 방문 예약 요청',
          body: this.compact(`${title || '매물'} · ${startAt}`),
          data: commonData,
        };
      case 'VISIT_RESERVATION_APPROVED':
        return {
          title: '방문 예약이 확정됐어요',
          body: this.compact(`${reservationNumber} · ${startAt}`),
          data: commonData,
        };
      case 'VISIT_RESERVATION_REJECTED':
        return {
          title: '방문 예약 요청 결과',
          body: this.compact(`${reservationNumber} 예약이 거절됐습니다.`),
          data: commonData,
        };
      case 'VISIT_RESERVATION_ALTERNATIVE_PROPOSED':
        return {
          title: '새 방문 시간을 확인해주세요',
          body: this.compact(`${reservationNumber} · ${startAt}`),
          data: commonData,
        };
      case 'VISIT_RESERVATION_ALTERNATIVE_ACCEPTED':
        return {
          title: '대안 방문 시간이 확정됐어요',
          body: this.compact(`${reservationNumber} · ${startAt}`),
          data: commonData,
        };
      case 'VISIT_RESERVATION_ALTERNATIVE_DECLINED':
        return {
          title: '대안 방문 시간이 거절됐어요',
          body: this.compact(`${reservationNumber} 예약을 확인해주세요.`),
          data: commonData,
        };
      case 'VISIT_RESERVATION_CANCELLED':
        return {
          title: '방문 예약이 취소됐어요',
          body: this.compact(`${reservationNumber} 예약이 취소됐습니다.`),
          data: commonData,
        };
      case 'RESERVATION_DEPOSIT_REFUNDED':
        return {
          title: '예약금 환불이 완료됐어요',
          body: this.compact(
            `${this.text(payload.refundedAmount)} ${this.text(payload.currency)} 환불 완료`,
          ),
          data: commonData,
        };
      case 'CHAT_MESSAGE_RECEIVED':
        return {
          title: '새 매물 채팅 메시지',
          body: this.compact(
            `${this.text(payload.listingNumber)} 매물 대화를 확인해주세요.`,
          ),
          data: commonData,
        };
      case 'PROPERTY_NEW_LISTING_MATCH':
        return {
          title: '저장 검색에 새 매물이 등록됐어요',
          body: this.compact(`${this.text(payload.listingNumber)} 매물을 확인해주세요.`),
          data: commonData,
        };
      default:
        return {
          title: 'LIFE HOME AI 알림',
          body: '새로운 알림이 도착했습니다.',
          data: commonData,
        };
    }
  }

  private payload(value: unknown): Payload {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Payload)
      : {};
  }

  private text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : '';
  }

  private dateTime(value: unknown): string {
    const raw = this.text(value);
    if (!raw) {
      return '';
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private compact(value: string): string {
    return value
      .replace(/\s*·\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }
}
