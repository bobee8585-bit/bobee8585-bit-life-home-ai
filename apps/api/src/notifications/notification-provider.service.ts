import { Injectable } from '@nestjs/common';
import {
  createHmac,
  createSign,
} from 'node:crypto';
import type { NotificationMessage } from './notification-template.service';

export class NotificationSendError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type NotificationProviderResult = {
  provider: string;
  messageId: string;
};

type GoogleToken = {
  value: string;
  expiresAt: number;
};

@Injectable()
export class NotificationProviderService {
  private googleToken?: GoogleToken;

  async sendPush(
    token: string,
    message: NotificationMessage,
  ): Promise<NotificationProviderResult> {
    const mode = this.mode('PUSH_PROVIDER_MODE', 'LOG');
    if (mode === 'LOG') {
      this.assertLogAllowed('PUSH_PROVIDER_MODE');
      return {
        provider: 'LOG',
        messageId: `log-push-${Date.now()}`,
      };
    }
    if (mode !== 'FCM') {
      throw new NotificationSendError(
        '푸시 공급자가 비활성화되어 있습니다.',
        'PUSH_PROVIDER_DISABLED',
        false,
      );
    }

    const projectId = this.required('FCM_PROJECT_ID');
    const accessToken = await this.fcmAccessToken();
    const response = await this.request(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: message.title,
              body: message.body,
            },
            data: message.data,
            android: {
              priority: 'high',
              notification: { channel_id: 'lifehome_transactional' },
            },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: { aps: { sound: 'default' } },
            },
          },
        }),
      },
      'FCM_TIMEOUT',
    );
    const body = await this.json(response);
    if (!response.ok) {
      const providerCode = this.fcmErrorCode(body);
      const permanent = ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(
        providerCode,
      );
      throw new NotificationSendError(
        'FCM 전송에 실패했습니다.',
        `FCM_${providerCode || response.status}`,
        !permanent && response.status !== 401 && response.status !== 403,
      );
    }
    const name = this.stringField(body, 'name');
    return {
      provider: 'FCM',
      messageId: name || `fcm-${Date.now()}`,
    };
  }

  async sendSms(
    phoneNumber: string,
    message: NotificationMessage,
  ): Promise<NotificationProviderResult> {
    const mode = this.mode('SMS_PROVIDER_MODE', 'LOG');
    if (mode === 'LOG') {
      this.assertLogAllowed('SMS_PROVIDER_MODE');
      return {
        provider: 'LOG',
        messageId: `log-sms-${Date.now()}`,
      };
    }
    if (mode !== 'NAVER_SENS') {
      throw new NotificationSendError(
        'SMS 공급자가 비활성화되어 있습니다.',
        'SMS_PROVIDER_DISABLED',
        false,
      );
    }

    const serviceId = this.required('NAVER_SENS_SERVICE_ID');
    const accessKey = this.required('NAVER_CLOUD_ACCESS_KEY');
    const secretKey = this.required('NAVER_CLOUD_SECRET_KEY');
    const sender = this.required('NAVER_SENS_SMS_FROM').replace(/\D/g, '');
    const timestamp = Date.now().toString();
    const uri = `/sms/v2/services/${encodeURIComponent(serviceId)}/messages`;
    const signature = createHmac('sha256', secretKey)
      .update(`POST ${uri}\n${timestamp}\n${accessKey}`)
      .digest('base64');
    const baseUrl =
      process.env.NAVER_SENS_API_BASE_URL?.replace(/\/$/, '') ??
      'https://sens.apigw.ntruss.com';
    const response = await this.request(
      `${baseUrl}${uri}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'x-ncp-apigw-timestamp': timestamp,
          'x-ncp-iam-access-key': accessKey,
          'x-ncp-apigw-signature-v2': signature,
        },
        body: JSON.stringify({
          type: 'SMS',
          from: sender,
          content: `[라이프홈] ${message.title}\n${message.body}`.slice(0, 90),
          messages: [{ to: this.domesticPhone(phoneNumber) }],
        }),
      },
      'SMS_PROVIDER_TIMEOUT',
    );
    const body = await this.json(response);
    if (!response.ok) {
      throw new NotificationSendError(
        'SENS SMS 전송에 실패했습니다.',
        `SENS_${this.stringField(body, 'statusCode') || response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return {
      provider: 'NAVER_SENS',
      messageId:
        this.stringField(body, 'requestId') || `sens-${Date.now()}`,
    };
  }

  private async fcmAccessToken(): Promise<string> {
    if (
      this.googleToken &&
      this.googleToken.expiresAt > Date.now() + 60_000
    ) {
      return this.googleToken.value;
    }
    const clientEmail = this.required('FCM_CLIENT_EMAIL');
    const privateKey = Buffer.from(
      this.required('FCM_PRIVATE_KEY_BASE64'),
      'base64',
    ).toString('utf8');
    const now = Math.floor(Date.now() / 1_000);
    const assertion = this.jwt(
      {
        alg: 'RS256',
        typ: 'JWT',
      },
      {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3_600,
      },
      privateKey,
    );
    const response = await this.request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      },
      'FCM_AUTH_TIMEOUT',
    );
    const body = await this.json(response);
    const accessToken = this.stringField(body, 'access_token');
    if (!response.ok || !accessToken) {
      throw new NotificationSendError(
        'FCM 인증에 실패했습니다.',
        `FCM_AUTH_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    const expiresIn = Number(
      typeof body === 'object' && body !== null && 'expires_in' in body
        ? body.expires_in
        : 3_600,
    );
    this.googleToken = {
      value: accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1_000,
    };
    return accessToken;
  }

  private jwt(
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
    privateKey: string,
  ): string {
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      'base64url',
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const unsigned = `${encodedHeader}.${encodedPayload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutCode: string,
  ): Promise<Response> {
    const timeout = Number(
      process.env.NOTIFICATION_PROVIDER_TIMEOUT_MS ?? 7_000,
    );
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new NotificationSendError(
        '알림 공급자 응답 시간이 초과됐습니다.',
        timeoutCode,
        true,
      );
    }
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private fcmErrorCode(body: unknown): string {
    if (typeof body !== 'object' || body === null || !('error' in body)) {
      return '';
    }
    const error = body.error;
    if (typeof error !== 'object' || error === null) {
      return '';
    }
    if ('details' in error && Array.isArray(error.details)) {
      for (const detail of error.details) {
        if (
          typeof detail === 'object' &&
          detail !== null &&
          'errorCode' in detail &&
          typeof detail.errorCode === 'string'
        ) {
          return detail.errorCode;
        }
      }
    }
    return 'status' in error && typeof error.status === 'string'
      ? error.status
      : '';
  }

  private stringField(body: unknown, field: string): string {
    return typeof body === 'object' &&
      body !== null &&
      field in body &&
      typeof body[field as keyof typeof body] === 'string'
      ? String(body[field as keyof typeof body])
      : '';
  }

  private domesticPhone(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.startsWith('82')) {
      return `0${digits.slice(2)}`;
    }
    return digits;
  }

  private mode(name: string, fallback: string): string {
    return process.env[name]?.trim().toUpperCase() || fallback;
  }

  private required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new NotificationSendError(
        `${name} 설정이 필요합니다.`,
        'PROVIDER_CONFIGURATION_MISSING',
        false,
      );
    }
    return value;
  }

  private assertLogAllowed(name: string): void {
    if (process.env.NODE_ENV === 'production') {
      throw new NotificationSendError(
        `운영 환경에서는 ${name}=LOG를 사용할 수 없습니다.`,
        'UNSAFE_LOG_PROVIDER',
        false,
      );
    }
  }
}
