const capabilities = [
  {
    title: '검증된 매물',
    description: '중개사 자격과 매물 상태를 확인하고 허위·중복 후보를 검수합니다.',
  },
  {
    title: '방문부터 계약까지',
    description: '문의, 방문 예약, 전자계약, 결제 흐름을 하나로 연결합니다.',
  },
  {
    title: '운영 상태 통제',
    description: '모든 메뉴와 API를 동일한 여섯 가지 상태 정책으로 관리합니다.',
  },
];

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero__content">
          <p className="eyebrow">LIFE HOME AI · FOUNDATION 0.11</p>
          <h1>집을 찾는 전 과정을<br />더 안전하게.</h1>
          <p className="hero__copy">
            검증된 부동산 검색부터 중개사 문의, 방문 예약과 계약까지 연결하는
            통합 플랫폼의 첫 개발 기반입니다.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#foundation">
              개발 기반 보기
            </a>
            <a className="button button--secondary" href="http://localhost:4000/v1/system/health">
              API 상태 확인
            </a>
          </div>
        </div>
        <aside className="status-card" aria-label="현재 개발 상태">
          <span className="status-card__badge">ACTIVE</span>
          <h2>부동산 서비스</h2>
          <dl>
            <div>
              <dt>국가</dt>
              <dd>대한민국</dd>
            </div>
            <div>
              <dt>언어</dt>
              <dd>한국어</dd>
            </div>
            <div>
              <dt>통화</dt>
              <dd>KRW</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="foundation" id="foundation">
        <p className="eyebrow">CORE FOUNDATION</p>
        <h2>첫 번째 구현 범위</h2>
        <div className="card-grid">
          {capabilities.map((capability, index) => (
            <article className="capability-card" key={capability.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
