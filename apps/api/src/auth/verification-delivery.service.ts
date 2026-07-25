import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type VerificationDelivery = {
  channel: 'EMAIL' | 'SMS';
  destination: string;
  code: string;
  purpose: string;
  expiresAt: Date;
};

@Injectable()
export class VerificationDeliveryService {
  async send(delivery: VerificationDelivery): Promise<void> {
    const mode = process.env.VERIFICATION_DELIVERY_MODE ?? 'log';
    if (mode === 'disabled' || (mode === 'log' && process.env.NODE_ENV === 'production')) {
      throw new ServiceUnavailableException(
        '인증 메시지 발송 서비스가 설정되지 않았습니다.',
      );
    }

    // 실제 운영에서는 이 어댑터를 이메일·SMS 공급자 구현으로 교체한다.
    if (mode === 'log') {
      console.info(
        `[verification:development] ${delivery.channel} ${delivery.purpose} -> ${this.mask(delivery.destination)} code=${delivery.code} (expires ${delivery.expiresAt.toISOString()})`,
      );
    }
  }

  private mask(destination: string): string {
    if (destination.includes('@')) {
      const [local, domain] = destination.split('@');
      return `${local.slice(0, 2)}***@${domain}`;
    }
    return `${destination.slice(0, 4)}***${destination.slice(-2)}`;
  }
}
