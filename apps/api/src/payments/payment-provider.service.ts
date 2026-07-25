import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createHash,
  createPrivateKey,
  sign,
  timingSafeEqual,
} from 'node:crypto';

export type PaymentProviderName =
  | 'MOCK'
  | 'TOSS'
  | 'NICEPAY'
  | 'NHN_KCP';

export interface PaymentProviderSnapshot {
  paymentReference: string;
  orderId: string;
  totalAmount: string;
  balanceAmount: string;
  canceledAmount: string;
  currency: string;
  status: string;
  approvedAt: Date | null;
  lastCancellation: {
    transactionReference: string;
    canceledAt: Date;
  } | null;
}

export interface PaymentCaptureInput {
  provider?: PaymentProviderName;
  paymentKey?: string;
  kcpEncData?: string;
  kcpEncInfo?: string;
  kcpPayType?: string;
  paymentNumber: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
}

interface TossCancel {
  cancelAmount?: number;
  canceledAt?: string;
  transactionKey?: string;
  cancelStatus?: string;
}

interface TossPayment {
  paymentKey?: string;
  orderId?: string;
  totalAmount?: number;
  balanceAmount?: number;
  currency?: string;
  status?: string;
  approvedAt?: string | null;
  cancels?: TossCancel[] | null;
}

interface NiceCancel {
  tid?: string;
  cancelledTid?: string;
  amount?: number;
  cancelledAt?: string;
}

interface NicePayment {
  resultCode?: string;
  resultMsg?: string;
  tid?: string;
  cancelledTid?: string;
  orderId?: string;
  ediDate?: string;
  signature?: string;
  status?: string;
  paidAt?: string | number | null;
  cancelledAt?: string | number | null;
  amount?: number;
  balanceAmt?: number;
  currency?: string;
  cancels?: NiceCancel[] | null;
}

interface KcpPayment {
  res_cd?: string;
  res_msg?: string;
  tno?: string;
  order_no?: string;
  amount?: string | number;
  rem_mny?: string | number;
  mod_mny?: string | number;
  mod_pcan_seq_no?: string;
  stat_ca_cd?: string;
  canc_card_yn?: string;
  app_time?: string;
  can_time?: string;
  canc_time?: string;
}

export class PaymentProviderException extends BadGatewayException {
  constructor(
    readonly providerCode: string,
    message = '결제 공급자 요청을 처리하지 못했습니다.',
  ) {
    super(message);
  }
}

@Injectable()
export class PaymentProviderService {
  readonly name = this.providerName(process.env.PAYMENT_PROVIDER_MODE);

  private readonly tossBaseUrl =
    process.env.TOSS_PAYMENTS_API_BASE_URL ??
    'https://api.tosspayments.com/v1';
  private readonly niceBaseUrl =
    process.env.NICEPAY_API_BASE_URL ?? 'https://api.nicepay.co.kr/v1';
  private readonly kcpBaseUrl =
    process.env.NHN_KCP_API_BASE_URL ??
    (process.env.NHN_KCP_ENVIRONMENT?.toLowerCase() === 'production'
      ? 'https://spl.kcp.co.kr'
      : 'https://stg-spl.kcp.co.kr');
  private readonly timeoutMs = this.positiveInteger(
    process.env.PAYMENT_PROVIDER_TIMEOUT_MS,
    7_000,
  );

  async capture(input: PaymentCaptureInput) {
    const provider = input.provider ?? this.name;
    this.assertProviderUsable(provider);
    if (provider === 'MOCK') {
      return this.captureMock(input);
    }
    if (provider === 'TOSS') {
      return this.captureToss(input);
    }
    if (provider === 'NICEPAY') {
      return this.captureNice(input);
    }
    return this.captureKcp(input);
  }

  async refund(input: {
    provider: PaymentProviderName;
    providerPaymentReference: string;
    paymentNumber: string;
    amount: string;
    currency: string;
    reason: string;
    idempotencyKey: string;
  }) {
    this.assertProviderUsable(input.provider);
    if (input.provider === 'MOCK') {
      if (!input.providerPaymentReference.startsWith('mock-capture-')) {
        throw new BadGatewayException(
          '환불할 개발 결제를 찾을 수 없습니다.',
        );
      }
      return {
        providerTransactionId: `mock-refund-${input.idempotencyKey}`,
        refundedAt: new Date(),
      };
    }
    if (input.provider === 'TOSS') {
      return this.refundToss(input);
    }
    if (input.provider === 'NICEPAY') {
      return this.refundNice(input);
    }
    return this.refundKcp(input);
  }

  async verifyPaymentWebhook(
    provider: PaymentProviderName,
    payload: unknown,
  ) {
    this.assertProviderUsable(provider);
    if (provider === 'TOSS') {
      return this.verifyTossWebhook(payload);
    }
    if (provider === 'NICEPAY') {
      return this.verifyNiceWebhook(payload);
    }
    if (provider === 'NHN_KCP') {
      return this.verifyKcpWebhook(payload);
    }
    throw new ServiceUnavailableException(
      '개발용 공급자는 웹훅을 처리하지 않습니다.',
    );
  }

  private captureMock(input: PaymentCaptureInput) {
    const paymentKey = this.requiredString(input.paymentKey, 'paymentKey');
    if (!paymentKey.startsWith('mock_')) {
      throw new BadGatewayException(
        '개발 결제 키 형식이 올바르지 않습니다.',
      );
    }
    if (paymentKey.startsWith('mock_fail')) {
      throw new BadGatewayException('개발 결제 승인에 실패했습니다.');
    }
    return {
      providerTransactionId: `mock-capture-${paymentKey}`,
      approvedAt: new Date(),
    };
  }

  private async captureToss(input: PaymentCaptureInput) {
    const paymentKey = this.requiredString(input.paymentKey, 'paymentKey');
    const payment = await this.tossRequest<TossPayment>(
      '/payments/confirm',
      {
        method: 'POST',
        body: JSON.stringify({
          paymentKey,
          orderId: input.paymentNumber,
          amount: this.wonAmount(input.amount),
        }),
      },
      input.idempotencyKey,
    );
    const snapshot = this.tossSnapshot(payment);
    this.assertCaptured(snapshot, {
      paymentReference: paymentKey,
      orderId: input.paymentNumber,
      amount: input.amount,
      currency: input.currency,
      code: 'TOSS_CAPTURE_MISMATCH',
    });
    return {
      providerTransactionId: snapshot.paymentReference,
      approvedAt: snapshot.approvedAt as Date,
    };
  }

  private async captureNice(input: PaymentCaptureInput) {
    const tid = this.requiredString(input.paymentKey, 'paymentKey');
    const payment = await this.niceRequest<NicePayment>(
      `/payments/${encodeURIComponent(tid)}`,
      {
        method: 'POST',
        body: JSON.stringify({ amount: this.wonAmount(input.amount) }),
      },
    );
    const snapshot = this.niceSnapshot(payment);
    this.assertCaptured(snapshot, {
      paymentReference: tid,
      orderId: input.paymentNumber,
      amount: input.amount,
      currency: input.currency,
      code: 'NICEPAY_CAPTURE_MISMATCH',
    });
    return {
      providerTransactionId: snapshot.paymentReference,
      approvedAt: snapshot.approvedAt as Date,
    };
  }

  private async captureKcp(input: PaymentCaptureInput) {
    if (input.currency.toUpperCase() !== 'KRW') {
      throw new PaymentProviderException(
        'NHN_KCP_UNSUPPORTED_CURRENCY',
        'NHN KCP 예약금 결제는 원화만 지원합니다.',
      );
    }
    const response = await this.kcpRequest<KcpPayment>(
      '/gw/enc/v1/payment',
      {
        tran_cd: '00100000',
        kcp_cert_info: this.kcpCertificate(),
        site_cd: this.kcpSiteCode(),
        enc_data: this.requiredString(input.kcpEncData, 'kcpEncData'),
        enc_info: this.requiredString(input.kcpEncInfo, 'kcpEncInfo'),
        ordr_mony: input.amount,
        pay_type: input.kcpPayType ?? 'PACA',
        ordr_no: input.paymentNumber,
      },
    );
    this.assertKcpSuccess(response);
    const tno = this.requiredString(response.tno, 'tno');
    const orderId = this.requiredString(response.order_no, 'order_no');
    const amount =
      response.amount === undefined
        ? null
        : this.wonAmount(String(response.amount));
    if (
      orderId !== input.paymentNumber ||
      amount !== this.wonAmount(input.amount) ||
      (input.kcpPayType ?? 'PACA') !== 'PACA'
    ) {
      throw new PaymentProviderException(
        'NHN_KCP_CAPTURE_MISMATCH',
        '승인된 결제 정보가 준비된 주문과 일치하지 않습니다.',
      );
    }
    const approvedAt = this.kcpDate(response.app_time) ?? new Date();
    return { providerTransactionId: tno, approvedAt };
  }

  private async refundToss(input: {
    providerPaymentReference: string;
    amount: string;
    currency: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const payment = await this.tossRequest<TossPayment>(
      `/payments/${encodeURIComponent(input.providerPaymentReference)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({
          cancelReason: String(input.reason).slice(0, 200),
          cancelAmount: this.wonAmount(input.amount),
          currency: input.currency.toUpperCase(),
        }),
      },
      input.idempotencyKey,
    );
    const snapshot = this.tossSnapshot(payment);
    return this.refundResult(snapshot, input, 'TOSS_REFUND_MISMATCH');
  }

  private async refundNice(input: {
    providerPaymentReference: string;
    amount: string;
    currency: string;
    reason: string;
    idempotencyKey: string;
  }) {
    const payment = await this.niceRequest<NicePayment>(
      `/payments/${encodeURIComponent(input.providerPaymentReference)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({
          reason: String(input.reason).slice(0, 100),
          orderId: this.providerOrderId('refund', input.idempotencyKey),
          cancelAmt: this.wonAmount(input.amount),
        }),
      },
    );
    const snapshot = this.niceSnapshot(payment);
    return this.refundResult(
      snapshot,
      input,
      'NICEPAY_REFUND_MISMATCH',
    );
  }

  private async refundKcp(input: {
    providerPaymentReference: string;
    paymentNumber: string;
    amount: string;
    currency: string;
    reason: string;
  }) {
    if (input.currency.toUpperCase() !== 'KRW') {
      throw new PaymentProviderException('NHN_KCP_UNSUPPORTED_CURRENCY');
    }
    const before = await this.getKcpPayment(
      input.providerPaymentReference,
      input.paymentNumber,
    );
    const cancelAmount = this.wonAmount(input.amount);
    const balance = this.wonAmount(before.balanceAmount);
    if (cancelAmount > balance) {
      throw new PaymentProviderException(
        'NHN_KCP_REFUND_AMOUNT_EXCEEDED',
        '취소 요청 금액이 공급자 잔액을 초과합니다.',
      );
    }
    const modType = cancelAmount === balance ? 'STSC' : 'STPC';
    const response = await this.kcpRequest<KcpPayment>(
      '/gw/mod/v1/cancel',
      {
        site_cd: this.kcpSiteCode(),
        kcp_cert_info: this.kcpCertificate(),
        kcp_sign_data: this.kcpSignature(
          `${this.kcpSiteCode()}^${input.providerPaymentReference}^${modType}`,
        ),
        mod_type: modType,
        tno: input.providerPaymentReference,
        mod_desc: String(input.reason).slice(0, 100),
        ...(modType === 'STPC'
          ? {
              mod_mny: String(cancelAmount),
              rem_mny: String(balance),
            }
          : {}),
      },
    );
    this.assertKcpSuccess(response);
    if (response.tno !== input.providerPaymentReference) {
      throw new PaymentProviderException('NHN_KCP_REFUND_MISMATCH');
    }
    const refundedAt =
      this.kcpDate(response.canc_time ?? response.can_time) ?? new Date();
    const providerTransactionId =
      response.mod_pcan_seq_no ??
      `${input.providerPaymentReference}:cancel:${this.kcpTimestamp(refundedAt)}`;
    return { providerTransactionId, refundedAt };
  }

  private async verifyTossWebhook(payload: unknown) {
    const event = this.object(payload);
    if (event.eventType !== 'PAYMENT_STATUS_CHANGED') {
      return { eventType: String(event.eventType ?? 'UNKNOWN'), snapshot: null };
    }
    const data = this.object(event.data);
    const paymentKey = this.requiredString(data.paymentKey, 'paymentKey');
    const orderId = this.requiredString(data.orderId, 'orderId');
    const snapshot = await this.getTossPayment(paymentKey);
    this.assertWebhookSnapshot(data, snapshot, {
      paymentReference: paymentKey,
      orderId,
      amountField: 'totalAmount',
      codePrefix: 'TOSS',
    });
    return { eventType: 'PAYMENT_STATUS_CHANGED', snapshot };
  }

  private async verifyNiceWebhook(payload: unknown) {
    const data = this.object(payload);
    const tid = this.requiredString(data.tid, 'tid');
    const orderId = this.requiredString(data.orderId, 'orderId');
    const snapshot = await this.getNicePayment(tid);
    this.assertWebhookSnapshot(data, snapshot, {
      paymentReference: tid,
      orderId,
      amountField: 'amount',
      codePrefix: 'NICEPAY',
    });
    return { eventType: 'PAYMENT_STATUS_CHANGED', snapshot };
  }

  private async verifyKcpWebhook(payload: unknown) {
    const data = this.object(payload);
    const siteCode = this.requiredString(data.site_cd, 'site_cd');
    const tno = this.requiredString(data.tno, 'tno');
    const orderId = this.requiredString(data.order_no, 'order_no');
    const txCode = this.requiredString(data.tx_cd, 'tx_cd');
    if (siteCode !== this.kcpSiteCode() || txCode !== 'TX00') {
      throw new PaymentProviderException(
        'NHN_KCP_WEBHOOK_MISMATCH',
        'NHN KCP 웹훅의 상점 또는 업무 코드가 일치하지 않습니다.',
      );
    }
    const snapshot = await this.getKcpPayment(tno, orderId, 'PAVC');
    if (
      snapshot.paymentReference !== tno ||
      snapshot.orderId !== orderId
    ) {
      throw new PaymentProviderException('NHN_KCP_WEBHOOK_ORDER_MISMATCH');
    }
    return { eventType: txCode, snapshot };
  }

  private async getTossPayment(
    paymentReference: string,
  ): Promise<PaymentProviderSnapshot> {
    const payment = await this.tossRequest<TossPayment>(
      `/payments/${encodeURIComponent(paymentReference)}`,
      { method: 'GET' },
    );
    return this.tossSnapshot(payment);
  }

  private async getNicePayment(
    paymentReference: string,
  ): Promise<PaymentProviderSnapshot> {
    const payment = await this.niceRequest<NicePayment>(
      `/payments/${encodeURIComponent(paymentReference)}`,
      { method: 'GET' },
    );
    return this.niceSnapshot(payment);
  }

  private async getKcpPayment(
    paymentReference: string,
    orderId: string,
    payType = 'PACA',
  ): Promise<PaymentProviderSnapshot> {
    const response = await this.kcpRequest<KcpPayment>('/std/inquery', {
      site_cd: this.kcpSiteCode(),
      kcp_cert_info: this.kcpCertificate(),
      tno: paymentReference,
      pay_type: payType,
      kcp_sign_data: this.kcpSignature(
        `${this.kcpSiteCode()}^${paymentReference}^${payType}`,
      ),
    });
    this.assertKcpSuccess(response);
    return this.kcpSnapshot(response, orderId);
  }

  private async tossRequest<T>(
    path: string,
    init: RequestInit,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.tossSecretKey()}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'ko-KR',
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return this.jsonRequest<T>(
      `${this.tossBaseUrl}${path}`,
      { ...init, headers: { ...headers, ...init.headers } },
      'TOSS',
      'message',
      'code',
    );
  }

  private async niceRequest<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const credentials = Buffer.from(
      `${this.niceClientKey()}:${this.niceSecretKey()}`,
    ).toString('base64');
    const body = await this.jsonRequest<T>(
      `${this.niceBaseUrl}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json;charset=utf-8',
          ...init.headers,
        },
      },
      'NICEPAY',
      'resultMsg',
      'resultCode',
    );
    const payment = body as NicePayment;
    if (payment.resultCode !== '0000') {
      throw new PaymentProviderException(
        `NICEPAY_${String(payment.resultCode ?? 'UNKNOWN').slice(0, 60)}`,
        payment.resultMsg ?? '나이스페이 요청이 거절되었습니다.',
      );
    }
    return body;
  }

  private async kcpRequest<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.jsonRequest<T>(
      `${this.kcpBaseUrl}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
      },
      'NHN_KCP',
      'res_msg',
      'res_cd',
    );
    return result;
  }

  private async jsonRequest<T>(
    url: string,
    init: RequestInit,
    provider: string,
    messageField: string,
    codeField: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new PaymentProviderException(`${provider}_NETWORK_ERROR`);
    }
    const parsed = (await response.json().catch(() => ({}))) as unknown;
    const body = this.record(parsed);
    if (!response.ok) {
      throw new PaymentProviderException(
        `${provider}_${String(body[codeField] ?? `HTTP_${response.status}`).slice(0, 60)}`,
        typeof body[messageField] === 'string'
          ? body[messageField]
          : '결제 공급자 요청이 거절되었습니다.',
      );
    }
    return body as T;
  }

  private tossSnapshot(payment: TossPayment): PaymentProviderSnapshot {
    const paymentReference = this.requiredString(
      payment.paymentKey,
      'paymentKey',
    );
    const orderId = this.requiredString(payment.orderId, 'orderId');
    const status = this.requiredString(payment.status, 'status');
    const currency = this.requiredString(
      payment.currency,
      'currency',
    ).toUpperCase();
    if (
      typeof payment.totalAmount !== 'number' ||
      typeof payment.balanceAmount !== 'number'
    ) {
      throw new PaymentProviderException('TOSS_INVALID_PAYMENT_RESPONSE');
    }
    const completedCancels = (payment.cancels ?? []).filter(
      (cancel) => cancel.cancelStatus === 'DONE',
    );
    const lastCancel = completedCancels.at(-1);
    const canceledAmount = completedCancels.reduce(
      (sum, cancel) => sum + (cancel.cancelAmount ?? 0),
      0,
    );
    return {
      paymentReference,
      orderId,
      totalAmount: String(payment.totalAmount),
      balanceAmount: String(payment.balanceAmount),
      canceledAmount: String(canceledAmount),
      currency,
      status,
      approvedAt: this.optionalDate(payment.approvedAt),
      lastCancellation:
        lastCancel?.transactionKey && lastCancel.canceledAt
          ? {
              transactionReference: lastCancel.transactionKey,
              canceledAt:
                this.optionalDate(lastCancel.canceledAt) ?? new Date(),
            }
          : null,
    };
  }

  private niceSnapshot(payment: NicePayment): PaymentProviderSnapshot {
    const tid = this.requiredString(payment.tid, 'tid');
    const orderId = this.requiredString(payment.orderId, 'orderId');
    if (
      typeof payment.amount !== 'number' ||
      typeof payment.balanceAmt !== 'number'
    ) {
      throw new PaymentProviderException('NICEPAY_INVALID_PAYMENT_RESPONSE');
    }
    this.verifyNiceSignature(payment);
    const statusMap: Record<string, string> = {
      paid: 'DONE',
      ready: 'READY',
      failed: 'ABORTED',
      cancelled: 'CANCELED',
      partialCancelled: 'PARTIAL_CANCELED',
      expired: 'EXPIRED',
    };
    const status = statusMap[String(payment.status)] ?? 'UNKNOWN';
    const lastCancel = payment.cancels?.at(-1);
    const canceledAt = this.optionalDate(
      lastCancel?.cancelledAt ?? payment.cancelledAt,
    );
    const cancellationReference =
      lastCancel?.cancelledTid ??
      lastCancel?.tid ??
      payment.cancelledTid;
    return {
      paymentReference: tid,
      orderId,
      totalAmount: String(payment.amount),
      balanceAmount: String(payment.balanceAmt),
      canceledAmount: String(payment.amount - payment.balanceAmt),
      currency: String(payment.currency ?? 'KRW').toUpperCase(),
      status,
      approvedAt: this.optionalDate(payment.paidAt),
      lastCancellation:
        cancellationReference && canceledAt
          ? {
              transactionReference: cancellationReference,
              canceledAt,
            }
          : null,
    };
  }

  private kcpSnapshot(
    payment: KcpPayment,
    orderId: string,
  ): PaymentProviderSnapshot {
    const tno = this.requiredString(payment.tno, 'tno');
    const total = this.wonAmount(String(payment.amount));
    const balance =
      payment.rem_mny === undefined
        ? total
        : Number(String(payment.rem_mny));
    if (!Number.isSafeInteger(balance) || balance < 0 || balance > total) {
      throw new PaymentProviderException('NHN_KCP_INVALID_PAYMENT_RESPONSE');
    }
    const providerStatus = String(payment.stat_ca_cd ?? '');
    let status = 'DONE';
    if (
      providerStatus === 'STSC' ||
      payment.canc_card_yn === 'Y' ||
      balance === 0
    ) {
      status = 'CANCELED';
    } else if (providerStatus === 'STPC' || balance < total) {
      status = 'PARTIAL_CANCELED';
    } else if (['STAF', 'STVF'].includes(providerStatus)) {
      status = 'ABORTED';
    } else if (['STIR', 'STSF'].includes(providerStatus)) {
      status = 'READY';
    }
    const canceledAt = this.kcpDate(
      payment.can_time ?? payment.canc_time,
    );
    return {
      paymentReference: tno,
      orderId,
      totalAmount: String(total),
      balanceAmount: String(balance),
      canceledAmount: String(total - balance),
      currency: 'KRW',
      status,
      approvedAt: this.kcpDate(payment.app_time),
      lastCancellation:
        canceledAt && total > balance
          ? {
              transactionReference:
                payment.mod_pcan_seq_no ??
                `${tno}:cancel:${this.kcpTimestamp(canceledAt)}`,
              canceledAt,
            }
          : null,
    };
  }

  private assertCaptured(
    snapshot: PaymentProviderSnapshot,
    expected: {
      paymentReference: string;
      orderId: string;
      amount: string;
      currency: string;
      code: string;
    },
  ) {
    if (
      snapshot.paymentReference !== expected.paymentReference ||
      snapshot.orderId !== expected.orderId ||
      snapshot.totalAmount !== expected.amount ||
      snapshot.currency !== expected.currency.toUpperCase() ||
      snapshot.status !== 'DONE' ||
      !snapshot.approvedAt
    ) {
      throw new PaymentProviderException(
        expected.code,
        '승인된 결제 정보가 준비된 주문과 일치하지 않습니다.',
      );
    }
  }

  private refundResult(
    snapshot: PaymentProviderSnapshot,
    input: {
      providerPaymentReference: string;
      currency: string;
    },
    code: string,
  ) {
    if (
      snapshot.paymentReference !== input.providerPaymentReference ||
      snapshot.currency !== input.currency.toUpperCase() ||
      !['CANCELED', 'PARTIAL_CANCELED'].includes(snapshot.status) ||
      !snapshot.lastCancellation
    ) {
      throw new PaymentProviderException(
        code,
        '취소된 결제 정보가 환불 요청과 일치하지 않습니다.',
      );
    }
    return {
      providerTransactionId:
        snapshot.lastCancellation.transactionReference,
      refundedAt: snapshot.lastCancellation.canceledAt,
    };
  }

  private assertWebhookSnapshot(
    data: Record<string, unknown>,
    snapshot: PaymentProviderSnapshot,
    expected: {
      paymentReference: string;
      orderId: string;
      amountField: string;
      codePrefix: string;
    },
  ) {
    if (
      snapshot.paymentReference !== expected.paymentReference ||
      snapshot.orderId !== expected.orderId
    ) {
      throw new PaymentProviderException(
        `${expected.codePrefix}_WEBHOOK_ORDER_MISMATCH`,
        '웹훅 주문 정보가 공급자 조회 결과와 일치하지 않습니다.',
      );
    }
    if (
      data[expected.amountField] !== undefined &&
      String(data[expected.amountField]) !== snapshot.totalAmount
    ) {
      throw new PaymentProviderException(
        `${expected.codePrefix}_WEBHOOK_AMOUNT_MISMATCH`,
        '웹훅 결제 금액이 공급자 조회 결과와 일치하지 않습니다.',
      );
    }
    if (
      data.currency !== undefined &&
      String(data.currency).toUpperCase() !== snapshot.currency
    ) {
      throw new PaymentProviderException(
        `${expected.codePrefix}_WEBHOOK_CURRENCY_MISMATCH`,
        '웹훅 통화가 공급자 조회 결과와 일치하지 않습니다.',
      );
    }
  }

  private verifyNiceSignature(payment: NicePayment): void {
    const signature = this.requiredString(payment.signature, 'signature');
    const ediDate = this.requiredString(payment.ediDate, 'ediDate');
    const tid = this.requiredString(payment.tid, 'tid');
    if (typeof payment.amount !== 'number') {
      throw new PaymentProviderException('NICEPAY_INVALID_PAYMENT_RESPONSE');
    }
    const expected = createHash('sha256')
      .update(`${tid}${payment.amount}${ediDate}${this.niceSecretKey()}`)
      .digest('hex');
    const actualBuffer = Buffer.from(signature.toLowerCase());
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new PaymentProviderException(
        'NICEPAY_SIGNATURE_MISMATCH',
        '나이스페이 응답 서명이 일치하지 않습니다.',
      );
    }
  }

  private assertKcpSuccess(payment: KcpPayment): void {
    if (payment.res_cd !== '0000') {
      throw new PaymentProviderException(
        `NHN_KCP_${String(payment.res_cd ?? 'UNKNOWN').slice(0, 60)}`,
        payment.res_msg ?? 'NHN KCP 요청이 거절되었습니다.',
      );
    }
  }

  private kcpSignature(value: string): string {
    try {
      const key = createPrivateKey({
        key: this.kcpPrivateKey(),
        format: 'pem',
        passphrase: process.env.NHN_KCP_PRIVATE_KEY_PASSPHRASE,
      });
      return sign('RSA-SHA256', Buffer.from(value, 'utf8'), key).toString(
        'base64',
      );
    } catch {
      throw new ServiceUnavailableException(
        'NHN KCP 개인키를 읽거나 서명할 수 없습니다.',
      );
    }
  }

  private assertProviderUsable(provider: PaymentProviderName): void {
    if (!['MOCK', 'TOSS', 'NICEPAY', 'NHN_KCP'].includes(provider)) {
      throw new ServiceUnavailableException(
        '지원하지 않는 결제 공급자 모드입니다.',
      );
    }
    if (provider === 'MOCK' && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        '운영 환경에서는 개발용 결제 공급자를 사용할 수 없습니다.',
      );
    }
  }

  private providerName(value: string | undefined): PaymentProviderName {
    const name = value?.trim().toUpperCase() ?? 'MOCK';
    if (name === 'NICE') {
      return 'NICEPAY';
    }
    if (name === 'KCP') {
      return 'NHN_KCP';
    }
    return name as PaymentProviderName;
  }

  private tossSecretKey(): string {
    return this.requiredEnvironment(
      'TOSS_PAYMENTS_SECRET_KEY',
      '토스페이먼츠 서버 비밀키가 설정되지 않았습니다.',
    );
  }

  private niceClientKey(): string {
    return this.requiredEnvironment(
      'NICEPAY_CLIENT_KEY',
      '나이스페이 클라이언트 키가 설정되지 않았습니다.',
    );
  }

  private niceSecretKey(): string {
    return this.requiredEnvironment(
      'NICEPAY_SECRET_KEY',
      '나이스페이 비밀키가 설정되지 않았습니다.',
    );
  }

  private kcpSiteCode(): string {
    return this.requiredEnvironment(
      'NHN_KCP_SITE_CODE',
      'NHN KCP 사이트 코드가 설정되지 않았습니다.',
    );
  }

  private kcpCertificate(): string {
    return this.pemEnvironment(
      'NHN_KCP_CERTIFICATE_BASE64',
      'NHN_KCP_CERTIFICATE_PEM',
      'NHN KCP 서비스 인증서가 설정되지 않았습니다.',
    );
  }

  private kcpPrivateKey(): string {
    return this.pemEnvironment(
      'NHN_KCP_PRIVATE_KEY_BASE64',
      'NHN_KCP_PRIVATE_KEY_PEM',
      'NHN KCP 개인키가 설정되지 않았습니다.',
    );
  }

  private pemEnvironment(
    base64Name: string,
    plainName: string,
    message: string,
  ): string {
    const encoded = process.env[base64Name]?.trim();
    if (encoded) {
      try {
        return Buffer.from(encoded, 'base64').toString('utf8');
      } catch {
        throw new ServiceUnavailableException(message);
      }
    }
    const plain = process.env[plainName]?.replace(/\\n/g, '\n').trim();
    if (!plain) {
      throw new ServiceUnavailableException(message);
    }
    return plain;
  }

  private requiredEnvironment(name: string, message: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new ServiceUnavailableException(message);
    }
    return value;
  }

  private wonAmount(value: string): number {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new PaymentProviderException('INVALID_KRW_AMOUNT');
    }
    return amount;
  }

  private providerOrderId(prefix: string, idempotencyKey: string): string {
    return `${prefix}-${createHash('sha256')
      .update(idempotencyKey)
      .digest('hex')
      .slice(0, 32)}`;
  }

  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new PaymentProviderException('INVALID_WEBHOOK_BODY');
    }
    return value as Record<string, unknown>;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new PaymentProviderException(
        'INVALID_PROVIDER_RESPONSE',
        `결제 공급자 응답에 ${field} 값이 없습니다.`,
      );
    }
    return value;
  }

  private optionalDate(value: unknown): Date | null {
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      value === 0 ||
      value === '0'
    ) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private kcpDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !/^\d{14}$/.test(value)) {
      return null;
    }
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`;
    return this.optionalDate(iso);
  }

  private kcpTimestamp(value: Date): string {
    return value.toISOString().replace(/\D/g, '').slice(0, 14);
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
