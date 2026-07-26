'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import styles from './admin.module.css';

type DashboardSummary = {
  reviewQueues: {
    pendingBrokers: number;
    pendingProperties: number;
    openReports: number;
  };
  paymentOperations: {
    pendingRefunds: number;
    overdueRefunds: number;
    failedRefunds: number;
  };
  systemOperations: {
    failedNotifications: number;
    failedContractWebhooks: number;
  };
  totalPending: number;
  urgentCount: number;
  generatedAt: string;
};

type ApiEnvelope<T> = { data: T };

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/v1';

export default function AdminDashboardPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        cache: 'no-store',
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
    setLoading(true);
    try {
      setSummary(await request<DashboardSummary>('/admin/dashboard/summary'));
      setMessage('');
    } finally {
      setLoading(false);
    }
  }, [request, token]);

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

  if (!token) {
    return (
      <main className={styles.shell}>
        <section className={styles.loginCard}>
          <p className={styles.eyebrow}>LIFE HOME AI · ADMIN CMS</p>
          <h1>운영 대시보드 로그인</h1>
          <p className={styles.muted}>
            관리자 운영 현황 조회 권한이 있는 계정으로 로그인해 주세요.
          </p>
          <form className={styles.loginForm} onSubmit={login}>
            <label>
              이메일
              <input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
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
          <p className={styles.eyebrow}>ADMIN CMS · OPERATIONS</p>
          <h1>오늘의 운영 현황</h1>
          <p className={styles.muted}>
            검수 대기와 장애·환불 위험 항목을 우선순위로 보여드립니다.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.secondaryButton}
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? '갱신 중' : '새로고침'}
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setToken('');
              setSummary(null);
            }}
          >
            로그아웃
          </button>
        </div>
      </header>

      {message && <p className={styles.message}>{message}</p>}

      <section className={styles.headlineMetrics}>
        <article className={styles.headlineCard}>
          <span>전체 처리 대기</span>
          <strong>{summary?.totalPending ?? 0}건</strong>
          <small>검수·신고·환불 대기 합계</small>
        </article>
        <article className={styles.alertCard}>
          <span>즉시 확인 필요</span>
          <strong>{summary?.urgentCount ?? 0}건</strong>
          <small>기한 초과·실패 항목 합계</small>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>REVIEW QUEUES</p>
              <h2>등록·매물 검수</h2>
            </div>
            <span className={styles.badge}>검수</span>
          </div>
          <dl className={styles.list}>
            <div>
              <dt>중개사 신청</dt>
              <dd>{summary?.reviewQueues.pendingBrokers ?? 0}건</dd>
            </div>
            <div>
              <dt>매물 승인</dt>
              <dd>{summary?.reviewQueues.pendingProperties ?? 0}건</dd>
            </div>
            <div>
              <dt>허위매물 신고</dt>
              <dd>{summary?.reviewQueues.openReports ?? 0}건</dd>
            </div>
          </dl>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>PAYMENT OPERATIONS</p>
              <h2>결제·환불</h2>
            </div>
            <Link className={styles.linkButton} href="/admin/payments">
              운영 화면
            </Link>
          </div>
          <dl className={styles.list}>
            <div>
              <dt>환불 대기</dt>
              <dd>{summary?.paymentOperations.pendingRefunds ?? 0}건</dd>
            </div>
            <div className={styles.dangerRow}>
              <dt>환불 기한 초과</dt>
              <dd>{summary?.paymentOperations.overdueRefunds ?? 0}건</dd>
            </div>
            <div className={styles.dangerRow}>
              <dt>환불 실패</dt>
              <dd>{summary?.paymentOperations.failedRefunds ?? 0}건</dd>
            </div>
          </dl>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>SYSTEM OPERATIONS</p>
              <h2>전송·연동 장애</h2>
            </div>
            <span className={styles.badgeNeutral}>시스템</span>
          </div>
          <dl className={styles.list}>
            <div className={styles.dangerRow}>
              <dt>알림 전송 실패</dt>
              <dd>{summary?.systemOperations.failedNotifications ?? 0}건</dd>
            </div>
            <div className={styles.dangerRow}>
              <dt>전자계약 웹훅 실패</dt>
              <dd>
                {summary?.systemOperations.failedContractWebhooks ?? 0}건
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <footer className={styles.footer}>
        마지막 집계:{' '}
        {summary?.generatedAt
          ? new Date(summary.generatedAt).toLocaleString('ko-KR')
          : '조회 중'}
      </footer>
    </main>
  );
}
