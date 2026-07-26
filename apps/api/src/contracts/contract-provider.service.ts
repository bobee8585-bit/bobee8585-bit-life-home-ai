import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { ElectronicContractProvider } from '../generated/prisma/client';

export type CreateSigningSessionInput = {
  contractId: string;
  contractNumber: string;
  provider: ElectronicContractProvider;
  requestedByRole: 'MEMBER' | 'REGISTRANT';
  property: {
    id: string;
    listingNumber: string;
    title: string;
  };
  parties: Array<{
    role: 'MEMBER' | 'REGISTRANT';
    userReference: string;
  }>;
};

export type SigningSession = {
  providerContractId: string;
  signingUrl: string;
  expiresAt: Date;
};

export type ContractWebhookPayload = {
  providerContractId: string;
  eventType: string;
  status:
    | 'SIGNING_PENDING'
    | 'PARTIALLY_SIGNED'
    | 'SIGNED'
    | 'DECLINED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'FAILED';
  parties?: Array<{
    role: 'MEMBER' | 'REGISTRANT';
    status: 'PENDING' | 'VIEWED' | 'SIGNED' | 'DECLINED';
    occurredAt?: string;
  }>;
  documentReference?: string;
  documentHash?: string;
  occurredAt?: string;
};

@Injectable()
export class ContractProviderService {
  async createSigningSession(
    input: CreateSigningSessionInput,
  ): Promise<SigningSession> {
    if (!this.enabledProviders().includes(input.provider)) {
      throw new ServiceUnavailableException(
        '선택한 전자계약 공급자는 현재 사용할 수 없습니다.',
      );
    }
    if (this.mode() === 'MOCK') {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          '운영 환경에서는 모의 전자계약 공급자를 사용할 수 없습니다.',
        );
      }
      return {
        providerContractId: `mock-${input.contractId}`,
        signingUrl: `https://contract.local/sign/${input.contractId}/${input.requestedByRole.toLowerCase()}`,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      };
    }

    const baseUrl = this.gatewayBaseUrl();
    const apiKey = process.env.CONTRACT_GATEWAY_API_KEY;
    const callbackUrl = process.env.CONTRACT_WEBHOOK_PUBLIC_URL;
    if (!apiKey || !callbackUrl) {
      throw new ServiceUnavailableException(
        '전자계약 공급자 인증 또는 콜백 설정이 없습니다.',
      );
    }
    const timeout = Number(process.env.CONTRACT_PROVIDER_TIMEOUT_MS ?? 7000);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/contracts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': input.contractId,
        },
        body: JSON.stringify({
          ...input,
          callbackUrl: `${callbackUrl.replace(/\/$/, '')}/${input.provider}`,
        }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new BadGatewayException(
        '전자계약 공급자에 연결하지 못했습니다.',
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `전자계약 공급자가 요청을 거부했습니다. (${response.status})`,
      );
    }
    const body = this.object(await response.json());
    const providerContractId = this.string(body.providerContractId);
    const signingUrl = this.string(body.signingUrl);
    const expiresAtValue = this.string(body.expiresAt);
    const expiresAt = new Date(expiresAtValue ?? '');
    if (
      !providerContractId ||
      !signingUrl ||
      Number.isNaN(expiresAt.getTime()) ||
      (process.env.NODE_ENV === 'production' &&
        !signingUrl.startsWith('https://'))
    ) {
      throw new BadGatewayException(
        '전자계약 공급자 응답 형식이 올바르지 않습니다.',
      );
    }
    return { providerContractId, signingUrl, expiresAt };
  }

  verifyWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    payload: unknown,
  ): ContractWebhookPayload {
    const secret = process.env.CONTRACT_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        '전자계약 웹훅 검증 키가 설정되지 않았습니다.',
      );
    }
    if (!rawBody || !signature?.startsWith('sha256=')) {
      throw new UnauthorizedException(
        '전자계약 웹훅 서명이 없습니다.',
      );
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const supplied = Buffer.from(signature.slice(7), 'hex');
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException(
        '전자계약 웹훅 서명이 올바르지 않습니다.',
      );
    }
    return this.webhookPayload(payload);
  }

  private webhookPayload(value: unknown): ContractWebhookPayload {
    const body = this.object(value);
    const providerContractId = this.string(body.providerContractId);
    const eventType = this.string(body.eventType);
    const status = this.string(body.status);
    const statuses = [
      'SIGNING_PENDING',
      'PARTIALLY_SIGNED',
      'SIGNED',
      'DECLINED',
      'CANCELLED',
      'EXPIRED',
      'FAILED',
    ];
    if (
      !providerContractId ||
      !eventType ||
      !status ||
      !statuses.includes(status)
    ) {
      throw new UnauthorizedException(
        '전자계약 웹훅 본문이 올바르지 않습니다.',
      );
    }
    const parties = Array.isArray(body.parties)
      ? body.parties.map((item) => {
          const party = this.object(item);
          const role = this.string(party.role);
          const partyStatus = this.string(party.status);
          if (
            !['MEMBER', 'REGISTRANT'].includes(role ?? '') ||
            !['PENDING', 'VIEWED', 'SIGNED', 'DECLINED'].includes(
              partyStatus ?? '',
            )
          ) {
            throw new UnauthorizedException(
              '전자계약 서명자 상태가 올바르지 않습니다.',
            );
          }
          return {
            role: role as 'MEMBER' | 'REGISTRANT',
            status: partyStatus as
              | 'PENDING'
              | 'VIEWED'
              | 'SIGNED'
              | 'DECLINED',
            occurredAt: this.string(party.occurredAt),
          };
        })
      : undefined;
    return {
      providerContractId,
      eventType,
      status: status as ContractWebhookPayload['status'],
      parties,
      documentReference: this.string(body.documentReference),
      documentHash: this.string(body.documentHash),
      occurredAt: this.string(body.occurredAt),
    };
  }

  private mode(): 'MOCK' | 'GATEWAY' {
    return process.env.CONTRACT_PROVIDER_MODE?.trim().toUpperCase() ===
      'GATEWAY'
      ? 'GATEWAY'
      : 'MOCK';
  }

  private enabledProviders(): ElectronicContractProvider[] {
    const configured =
      process.env.CONTRACT_ENABLED_PROVIDERS ??
      'MODOOSIGN,EFORM_SIGN,GOVERNMENT';
    const allowed = new Set(Object.values(ElectronicContractProvider));
    return configured
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value): value is ElectronicContractProvider =>
        allowed.has(value as ElectronicContractProvider),
      );
  }

  private gatewayBaseUrl(): string {
    const value = process.env.CONTRACT_GATEWAY_BASE_URL?.replace(/\/$/, '');
    if (
      !value ||
      (process.env.NODE_ENV === 'production' &&
        !value.startsWith('https://'))
    ) {
      throw new ServiceUnavailableException(
        '전자계약 공급자 게이트웨이 주소가 올바르지 않습니다.',
      );
    }
    return value;
  }

  private object(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }

  private string(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : undefined;
  }
}
