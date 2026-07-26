'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import styles from './payments.module.css';

type Summary = {
  paidAmount: string;
  refundedAmount: string;
  pendingRefundCount: number;
  overdueRefundCount: number;
  failedRefundCount: number;
};

type Payment = {
  id: string;
  paymentNumber: string;
  reservationNumber: string;
  listingNumber: string;
  propertyTitle: string;
  memberNumber: string;
  amount: string;
  currency: string;
  status: string;
  refundedAmount: string;
  refundDueAt: string | null;
  refundOverdue: boolean;
  failureCode: string | null;
};

type ApiEnvelope<T> = { data: T };

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/v1';

function money(value: string) {
  return new Intl.NumberFormat('ko-KR').format(Number(value));
}

function idempotencyKey(depositId: string) {
  return `admin-refund-${depositId}-${crypto.randomUUID()}`.slice(0, 100);
}

export default function AdminPaymentsPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
      const body = (await response.json()) as
        | ApiEnvelope<T>
        | { message?: string; error?: { message?: string } };
      if (!response.ok) {
        throw new Error(
          ('error' in body && body.error?.message) ||
            ('message' in body && body.message) ||
            '요청을 처리하지 못했습니다.',
        );
      }
      return (body as ApiEnvelope<T>).data;
    },
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    const [nextSummary, result] = await Promise.all([
      request<Summary>('/admin/payments/summary'),
      request<{ items: Payment[] }>(`/admin/payments?${params}`),
    ]);
    setSummary(nextSummary);
    setPayments(result.items);
  }, [request, search, status, token]);

  useEffect(() => {
    void load().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : '조회에 실패했습니다.'),
    );
  }, [load]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await request<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(result.accessToken);
      setPassword('');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : '로그인에 실패했습니다.');
    }
  }

  async function retry(payment: Payment) {
    setBusyId(payment.id);
    setMessage('');
    try {
      await request(`/admin/payments/${payment.id}/refund/retry`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey(payment.id) },
      });
      setMessage(`${payment.paymentNumber} 환불을 재처리했습니다.`);
      await load();
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : '환불 재처리에 실패했습니다.',
      );
    } finally {
      setBusyId('');
    }
  }

  if (!token) {
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <p className={styles.eyebrow}>LIFE HOME AI · ADMIN CMS</p>
          <h1 className={styles.loginTitle}>결제 운영 로그인</h1>
          <p className={styles.muted}>
            결제 조회 또는 환불 권한이 있는 관리자 계정으로 로그인해 주세요.
          </p>
          <form className={styles.loginForm} onSubmit={login}>
            <label className={styles.field}>
              이메일
              <input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              비밀번호
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className={styles.primaryButton} type="submit">
              로그인
            </button>
          </form>
          {message && <p className={styles.message}>{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ADMIN CMS · PAYMENT OPERATIONS</p>
          <h1 className={styles.title}>결제·환불 운영</h1>
        </div>
        <button className={styles.secondaryButton} onClick={() => setToken('')}>
          로그아웃
        </button>
      </header>

      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span>총 결제액</span>
          <strong>{money(summary?.paidAmount ?? '0')}원</strong>
        </article>
        <article className={styles.metric}>
          <span>총 환불액</span>
          <strong>{money(summary?.refundedAmount ?? '0')}원</strong>
        </article>
        <article className={styles.metric}>
          <span>환불 대기</span>
          <strong>{summary?.pendingRefundCount ?? 0}건</strong>
        </article>
        <article className={styles.metricWarning}>
          <span>기한 초과 / 실패</span>
          <strong>
            {summary?.overdueRefundCount ?? 0} / {summary?.failedRefundCount ?? 0}건
          </strong>
        </article>
      </section>

      <section className={styles.panel}>
        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            aria-label="결제 검색"
            placeholder="결제·예약·매물·회원번호 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="결제 상태"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">전체 상태</option>
            <option value="PAID">결제 완료</option>
            <option value="REFUND_PENDING">환불 대기</option>
            <option value="PARTIALLY_REFUNDED">부분 환불</option>
            <option value="REFUNDED">환불 완료</option>
            <option value="FAILED">실패</option>
          </select>
          <button className={styles.primaryButton} type="submit">
            조회
          </button>
        </form>
        {message && <p className={styles.message}>{message}</p>}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>결제번호</th>
                <th>매물 / 회원</th>
                <th>금액</th>
                <th>상태</th>
                <th>환불기한</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>
                    <strong>{payment.paymentNumber}</strong>
                    <small>{payment.reservationNumber}</small>
                  </td>
                  <td>
                    <strong>{payment.listingNumber}</strong>
                    <small>{payment.memberNumber}</small>
                  </td>
                  <td>{money(payment.amount)}원</td>
                  <td>
                    <span
                      className={
                        payment.refundOverdue || payment.failureCode
                          ? styles.badgeDanger
                          : styles.badge
                      }
                    >
                      {payment.status}
                    </span>
                  </td>
                  <td>
                    {payment.refundDueAt
                      ? new Date(payment.refundDueAt).toLocaleString('ko-KR')
                      : '—'}
                  </td>
                  <td>
                    {payment.status === 'REFUND_PENDING' ? (
                      <button
                        className={styles.retryButton}
                        disabled={busyId === payment.id}
                        onClick={() => void retry(payment)}
                      >
                        {busyId === payment.id ? '처리 중' : '환불 재처리'}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!payments.length && (
            <p className={styles.empty}>조건에 맞는 결제 내역이 없습니다.</p>
          )}
        </div>
      </section>
    </main>
  );
}
