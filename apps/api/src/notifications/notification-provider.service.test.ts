import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationProviderService,
  NotificationSendError,
} from './notification-provider.service';

const message = {
  title: '방문 예약이 확정됐어요',
  body: 'VR-2026-TEST · 7. 26. 10:00',
  data: {
    notificationType: 'VISIT_RESERVATION_APPROVED',
    aggregateType: 'VisitReservation',
    aggregateId: 'reservation',
  },
};

describe('NotificationProviderService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('signs and sends a NAVER SENS SMS request', async () => {
    vi.stubEnv('SMS_PROVIDER_MODE', 'NAVER_SENS');
    vi.stubEnv('NAVER_SENS_SERVICE_ID', 'service-id');
    vi.stubEnv('NAVER_CLOUD_ACCESS_KEY', 'access-key');
    vi.stubEnv('NAVER_CLOUD_SECRET_KEY', 'secret-key');
    vi.stubEnv('NAVER_SENS_SMS_FROM', '0212345678');
    vi.spyOn(Date, 'now').mockReturnValue(1_785_000_000_000);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ requestId: 'sens-request-1' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new NotificationProviderService().sendSms(
      '+82 10-1234-5678',
      message,
    );

    const uri = '/sms/v2/services/service-id/messages';
    const expectedSignature = createHmac('sha256', 'secret-key')
      .update(`POST ${uri}\n1785000000000\naccess-key`)
      .digest('base64');
    expect(result).toEqual({
      provider: 'NAVER_SENS',
      messageId: 'sens-request-1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://sens.apigw.ntruss.com${uri}`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-ncp-apigw-signature-v2': expectedSignature,
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).messages).toEqual([
      { to: '01012345678' },
    ]);
  });

  it('blocks log providers in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PUSH_PROVIDER_MODE', 'LOG');

    await expect(
      new NotificationProviderService().sendPush('test-token', message),
    ).rejects.toMatchObject<Partial<NotificationSendError>>({
      code: 'UNSAFE_LOG_PROVIDER',
      retryable: false,
    });
  });
});
