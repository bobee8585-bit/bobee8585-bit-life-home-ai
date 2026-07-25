import { BadGatewayException } from '@nestjs/common';
import {
  createHash,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentProviderService } from './payment-provider.service';

describe('PaymentProviderService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('captures a development payment with an idempotent provider reference', async () => {
    const result = await new PaymentProviderService().capture({
      paymentKey: 'mock_payment_approved',
      paymentNumber: 'PAY-2026-TEST',
      amount: '10000',
      currency: 'KRW',
      idempotencyKey: 'confirm-key-00000001',
    });

    expect(result.providerTransactionId).toBe(
      'mock-capture-mock_payment_approved',
    );
  });

  it('surfaces a failed development payment', async () => {
    await expect(
      new PaymentProviderService().capture({
        paymentKey: 'mock_fail_payment',
        paymentNumber: 'PAY-2026-TEST',
        amount: '10000',
        currency: 'KRW',
        idempotencyKey: 'confirm-key-00000002',
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('confirms a Toss payment with server authentication and idempotency', async () => {
    vi.stubEnv('PAYMENT_PROVIDER_MODE', 'TOSS');
    vi.stubEnv('TOSS_PAYMENTS_SECRET_KEY', 'test_sk_secret');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          paymentKey: 'toss_payment_key',
          orderId: 'PAY-2026-TEST',
          totalAmount: 10000,
          balanceAmount: 10000,
          currency: 'KRW',
          status: 'DONE',
          approvedAt: '2026-07-25T01:00:00+09:00',
          cancels: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new PaymentProviderService().capture({
      paymentKey: 'toss_payment_key',
      paymentNumber: 'PAY-2026-TEST',
      amount: '10000',
      currency: 'KRW',
      idempotencyKey: 'confirm-key-00000003',
    });

    expect(result.providerTransactionId).toBe('toss_payment_key');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('test_sk_secret:').toString('base64')}`,
          'Idempotency-Key': 'confirm-key-00000003',
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      paymentKey: 'toss_payment_key',
      orderId: 'PAY-2026-TEST',
      amount: 10000,
    });
  });

  it('rejects a Toss approval whose amount differs from the order', async () => {
    vi.stubEnv('PAYMENT_PROVIDER_MODE', 'TOSS');
    vi.stubEnv('TOSS_PAYMENTS_SECRET_KEY', 'test_sk_secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            paymentKey: 'toss_payment_key',
            orderId: 'PAY-2026-TEST',
            totalAmount: 9000,
            balanceAmount: 9000,
            currency: 'KRW',
            status: 'DONE',
            approvedAt: '2026-07-25T01:00:00+09:00',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      new PaymentProviderService().capture({
        paymentKey: 'toss_payment_key',
        paymentNumber: 'PAY-2026-TEST',
        amount: '10000',
        currency: 'KRW',
        idempotencyKey: 'confirm-key-00000004',
      }),
    ).rejects.toThrow('승인된 결제 정보가 준비된 주문과 일치하지 않습니다.');
  });

  it('rejects a payment webhook whose amount was altered', async () => {
    vi.stubEnv('PAYMENT_PROVIDER_MODE', 'TOSS');
    vi.stubEnv('TOSS_PAYMENTS_SECRET_KEY', 'test_sk_secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            paymentKey: 'toss_payment_key',
            orderId: 'PAY-2026-TEST',
            totalAmount: 10000,
            balanceAmount: 10000,
            currency: 'KRW',
            status: 'DONE',
            approvedAt: '2026-07-25T01:00:00+09:00',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      new PaymentProviderService().verifyPaymentWebhook(
        'TOSS',
        {
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            paymentKey: 'toss_payment_key',
            orderId: 'PAY-2026-TEST',
            totalAmount: 9000,
            currency: 'KRW',
          },
        },
      ),
    ).rejects.toThrow(
      '웹훅 결제 금액이 공급자 조회 결과와 일치하지 않습니다.',
    );
  });

  it('confirms a NICEPAY payment and verifies the signed response', async () => {
    vi.stubEnv('PAYMENT_PROVIDER_MODE', 'NICEPAY');
    vi.stubEnv('NICEPAY_CLIENT_KEY', 'nice_client_key');
    vi.stubEnv('NICEPAY_SECRET_KEY', 'nice_secret_key');
    const ediDate = '20260725191000';
    const signature = createHash('sha256')
      .update(`nice_tid_00110000${ediDate}nice_secret_key`)
      .digest('hex');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          resultCode: '0000',
          resultMsg: '정상 처리되었습니다.',
          tid: 'nice_tid_001',
          orderId: 'PAY-2026-NICE',
          ediDate,
          signature,
          status: 'paid',
          paidAt: '2026-07-25T19:10:00+09:00',
          amount: 10000,
          balanceAmt: 10000,
          currency: 'KRW',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new PaymentProviderService().capture({
      paymentKey: 'nice_tid_001',
      paymentNumber: 'PAY-2026-NICE',
      amount: '10000',
      currency: 'KRW',
      idempotencyKey: 'confirm-key-nicepay-0001',
    });

    expect(result.providerTransactionId).toBe('nice_tid_001');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.nicepay.co.kr/v1/payments/nice_tid_001',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from(
            'nice_client_key:nice_secret_key',
          ).toString('base64')}`,
        }),
      }),
    );
  });

  it('rejects a NICEPAY response with an altered signature', async () => {
    vi.stubEnv('PAYMENT_PROVIDER_MODE', 'NICEPAY');
    vi.stubEnv('NICEPAY_CLIENT_KEY', 'nice_client_key');
    vi.stubEnv('NICEPAY_SECRET_KEY', 'nice_secret_key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            resultCode: '0000',
            tid: 'nice_tid_002',
            orderId: 'PAY-2026-NICE',
            ediDate: '20260725191000',
            signature: '0'.repeat(64),
            status: 'paid',
            paidAt: '2026-07-25T19:10:00+09:00',
            amount: 10000,
            balanceAmt: 10000,
            currency: 'KRW',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      new PaymentProviderService().capture({
        paymentKey: 'nice_tid_002',
        paymentNumber: 'PAY-2026-NICE',
        amount: '10000',
        currency: 'KRW',
        idempotencyKey: 'confirm-key-nicepay-0002',
      }),
    ).rejects.toThrow('나이스페이 응답 서명이 일치하지 않습니다.');
  });

  it('cancels a NICEPAY payment and returns the cancellation transaction', async () => {
    vi.stubEnv('NICEPAY_CLIENT_KEY', 'nice_client_key');
    vi.stubEnv('NICEPAY_SECRET_KEY', 'nice_secret_key');
    const ediDate = '20260725191200';
    const signature = createHash('sha256')
      .update(`nice_tid_00310000${ediDate}nice_secret_key`)
      .digest('hex');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          resultCode: '0000',
          resultMsg: '정상 처리되었습니다.',
          tid: 'nice_tid_003',
          cancelledTid: 'nice_cancel_003',
          orderId: 'refund-provider-order',
          ediDate,
          signature,
          status: 'cancelled',
          paidAt: '2026-07-25T19:10:00+09:00',
          cancelledAt: '2026-07-25T19:12:00+09:00',
          amount: 10000,
          balanceAmt: 0,
          currency: 'KRW',
          cancels: [
            {
              tid: 'nice_cancel_003',
              amount: 10000,
              cancelledAt: '2026-07-25T19:12:00+09:00',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new PaymentProviderService().refund({
      provider: 'NICEPAY',
      providerPaymentReference: 'nice_tid_003',
      paymentNumber: 'PAY-2026-NICE',
      amount: '10000',
      currency: 'KRW',
      reason: '방문 예약 취소',
      idempotencyKey: 'refund-key-nicepay-0003',
    });

    expect(result.providerTransactionId).toBe('nice_cancel_003');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(
      expect.objectContaining({
        reason: '방문 예약 취소',
        cancelAmt: 10000,
      }),
    );
  });

  it('confirms an NHN KCP payment with certificate-backed request data', async () => {
    vi.stubEnv('PAYMENT_PROVIDER_MODE', 'NHN_KCP');
    vi.stubEnv('NHN_KCP_SITE_CODE', 'T0000');
    vi.stubEnv(
      'NHN_KCP_CERTIFICATE_BASE64',
      Buffer.from('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----')
        .toString('base64'),
    );
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          res_cd: '0000',
          res_msg: '정상 처리',
          tno: 'kcp_tno_001',
          order_no: 'PAY-2026-KCP',
          amount: '10000',
          app_time: '20260725191500',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new PaymentProviderService().capture({
      kcpEncData: 'encrypted-payment-data',
      kcpEncInfo: 'encrypted-payment-info',
      kcpPayType: 'PACA',
      paymentNumber: 'PAY-2026-KCP',
      amount: '10000',
      currency: 'KRW',
      idempotencyKey: 'confirm-key-kcp-0001',
    });

    expect(result.providerTransactionId).toBe('kcp_tno_001');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(
      expect.objectContaining({
        tran_cd: '00100000',
        site_cd: 'T0000',
        enc_data: 'encrypted-payment-data',
        enc_info: 'encrypted-payment-info',
        ordr_mony: '10000',
        pay_type: 'PACA',
        ordr_no: 'PAY-2026-KCP',
      }),
    );
  });

  it('signs an NHN KCP lookup before verifying a webhook', async () => {
    vi.stubEnv('PAYMENT_PROVIDER_MODE', 'TOSS');
    vi.stubEnv('NHN_KCP_SITE_CODE', 'T0000');
    vi.stubEnv(
      'NHN_KCP_CERTIFICATE_BASE64',
      Buffer.from('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----')
        .toString('base64'),
    );
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    vi.stubEnv(
      'NHN_KCP_PRIVATE_KEY_BASE64',
      Buffer.from(privateKey).toString('base64'),
    );
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          res_cd: '0000',
          res_msg: '정상 처리',
          tno: 'kcp_tno_002',
          amount: '10000',
          rem_mny: '10000',
          stat_ca_cd: 'STSR',
          app_time: '20260725192000',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const verified = await new PaymentProviderService().verifyPaymentWebhook(
      'NHN_KCP',
      {
        site_cd: 'T0000',
        tno: 'kcp_tno_002',
        order_no: 'PAY-2026-KCP',
        tx_cd: 'TX00',
        tx_tm: '20260725192000',
      },
    );

    expect(verified.snapshot?.status).toBe('DONE');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      kcp_sign_data: string;
    };
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from('T0000^kcp_tno_002^PAVC'),
        publicKey,
        Buffer.from(body.kcp_sign_data, 'base64'),
      ),
    ).toBe(true);
  });

  it('looks up and partially cancels an NHN KCP payment with RSA signatures', async () => {
    vi.stubEnv('NHN_KCP_SITE_CODE', 'T0000');
    vi.stubEnv(
      'NHN_KCP_CERTIFICATE_BASE64',
      Buffer.from('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----')
        .toString('base64'),
    );
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    vi.stubEnv(
      'NHN_KCP_PRIVATE_KEY_BASE64',
      Buffer.from(privateKey).toString('base64'),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            res_cd: '0000',
            tno: 'kcp_tno_003',
            amount: '10000',
            rem_mny: '10000',
            stat_ca_cd: 'STSR',
            app_time: '20260725192500',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            res_cd: '0000',
            tno: 'kcp_tno_003',
            mod_pcan_seq_no: '0001',
            canc_time: '20260725192600',
            rem_mny: '6000',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new PaymentProviderService().refund({
      provider: 'NHN_KCP',
      providerPaymentReference: 'kcp_tno_003',
      paymentNumber: 'PAY-2026-KCP',
      amount: '4000',
      currency: 'KRW',
      reason: '일부 환불',
      idempotencyKey: 'refund-key-kcp-0003',
    });

    expect(result.providerTransactionId).toBe('0001');
    const lookupBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as { kcp_sign_data: string };
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from('T0000^kcp_tno_003^PACA'),
        publicKey,
        Buffer.from(lookupBody.kcp_sign_data, 'base64'),
      ),
    ).toBe(true);
    const cancelBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as Record<string, string>;
    expect(cancelBody).toEqual(
      expect.objectContaining({
        mod_type: 'STPC',
        tno: 'kcp_tno_003',
        mod_mny: '4000',
        rem_mny: '10000',
        mod_desc: '일부 환불',
      }),
    );
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from('T0000^kcp_tno_003^STPC'),
        publicKey,
        Buffer.from(cancelBody.kcp_sign_data, 'base64'),
      ),
    ).toBe(true);
  });
});
