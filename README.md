# LIFE HOME AI 0.13.0

LIFE HOME AI 부동산 플랫폼의 첫 실행 가능한 모노레포입니다.

## 구성

- `apps/api`: NestJS REST API
- `apps/web`: Next.js 반응형 웹 기반
- `apps/mobile`: Flutter 사용자 앱 기반
- `packages/contracts`: 앱·웹·API 공통 계약 타입
- `docs`: 아키텍처와 개발 문서

## 시작하기

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run dev:api
```

다른 터미널에서 웹을 실행합니다.

```bash
npm run dev:web
```

- API 상태: `http://localhost:4000/v1/system/health`
- 앱 설정: `http://localhost:4000/v1/app/config`
- 웹: `http://localhost:3000`

## 인증 API

```http
POST /v1/auth/register
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/logout
GET  /v1/auth/me
POST /v1/auth/verification/email/request
POST /v1/auth/verification/email/confirm
POST /v1/auth/verification/phone/request
POST /v1/auth/verification/phone/confirm
POST /v1/auth/password-reset/request
POST /v1/auth/password-reset/confirm
POST /v1/brokers/registrations
GET  /v1/admin/broker-registrations
POST /v1/admin/broker-registrations/:userId/approve
POST /v1/admin/broker-registrations/:userId/reject
GET  /v1/properties
GET  /v1/properties/:id
GET  /v1/properties/mine
POST /v1/properties
PATCH /v1/properties/:id
POST /v1/properties/:id/submit
POST /v1/properties/:id/media
GET  /v1/media/:uploadId/content
GET  /v1/media/:uploadId/thumbnail
GET  /v1/media/:uploadId/content/preview
GET  /v1/media/:uploadId/thumbnail/preview
POST /v1/properties/:id/reports
GET  /v1/property-reports/mine
GET  /v1/admin/properties
POST /v1/admin/properties/:id/approve
POST /v1/admin/properties/:id/reject
GET  /v1/admin/property-reports
POST /v1/admin/property-reports/:reportId/review
GET  /v1/currencies
GET  /v1/exchange-rates/:base/:quote
GET  /v1/currency/convert?amount=1000000&from=KRW&to=USD
POST /v1/properties/:propertyId/visit-reservations
GET  /v1/visit-reservations/mine
POST /v1/visit-route-plans/optimize
POST /v1/visit-reservations/:reservationId/cancel
POST /v1/visit-reservations/:reservationId/alternative/accept
POST /v1/visit-reservations/:reservationId/alternative/decline
GET  /v1/broker/visit-reservations
POST /v1/broker/visit-reservations/:reservationId/approve
POST /v1/broker/visit-reservations/:reservationId/reject
POST /v1/broker/visit-reservations/:reservationId/alternative
GET  /v1/property-manager/visit-reservations
POST /v1/property-manager/visit-reservations/:reservationId/approve
POST /v1/property-manager/visit-reservations/:reservationId/reject
POST /v1/property-manager/visit-reservations/:reservationId/alternative
GET  /v1/visit-reservations/:reservationId/deposit
POST /v1/visit-reservations/:reservationId/deposit/prepare
POST /v1/visit-reservations/:reservationId/deposit/confirm
POST /v1/payment-webhooks/toss
POST /v1/payment-webhooks/nicepay
POST /v1/payment-webhooks/nhn-kcp
POST /v1/notifications/push-endpoints
GET  /v1/notifications/push-endpoints
DELETE /v1/notifications/push-endpoints/:deviceId
```

회원가입 예시:

```json
{
  "email": "user@example.com",
  "password": "Safe-password-2026",
  "displayName": "라이프홈 사용자",
  "locale": "ko-KR",
  "timezone": "Asia/Seoul",
  "countryCode": "KR"
}
```

Access Token은 API 호출에 사용하고 Refresh Token은 매번 교체됩니다. 이미
사용한 Refresh Token이 다시 제출되면 해당 로그인 세션을 폐기합니다.

인증 코드는 10분 동안 유효하고 5회 실패 시 사용할 수 없습니다. 비밀번호
재설정이 완료되면 기존 로그인 세션을 모두 폐기합니다. 개발 환경의
`VERIFICATION_DELIVERY_MODE=log`는 로컬 검증을 위해 마스킹된 수신 대상과
인증 코드를 개발 콘솔에 기록합니다. 운영 환경에서는 이 모드를 거부하므로
`VerificationDeliveryService`를 실제 이메일·SMS 공급자 어댑터로 교체해야
합니다.

중개사 등록은 이메일·휴대폰 인증을 모두 마친 회원만 신청할 수 있으며,
중개사와 중개사무소는 각각 `PENDING` 상태로 생성되어 관리자 심사를 기다립니다.
세부 Permission 가드와 `BROKER_REGISTRATION` 메뉴 상태 가드가 API에서 함께
적용됩니다.

중개사 승인이 완료되면 `BROKER`와 `BROKER_MANAGER` 역할이 부여됩니다. 승인된
중개사는 중개사무소 매물을 등록할 수 있습니다. 일반회원도 휴대폰 본인인증 후
`OWNER_DIRECT` 유형으로 본인 소유 또는 적법한 위임을 받은 매물을 등록할 수
있습니다. 두 유형 모두 검수 요청 후 관리자가 승인해야 공개 검색에 노출됩니다.

직거래 등록은 `ownershipVerification`에 소유자·위임자 구분과 격리 저장소의
증빙 참조값을 제출하고, 소유·위임 권한 및 중개행위 금지 확인에 동의해야 합니다.
증빙 참조값은 암호화 저장되며 관리자 검수에서만 복호화됩니다. 공개 응답은
`DIRECT_OWNER`, `brokerageFee=NONE`을 표시하고 중개사무소 정보는 `null`입니다.
직거래 등록자는 중개업자로 표시되거나 중개수수료를 받을 수 없습니다.

매물 상태는 `DRAFT → PENDING_REVIEW → ACTIVE` 또는 `REJECTED` 순서로
전이됩니다. 반려 매물은 수정하면 다시 `DRAFT`가 되며 재검수를 요청할 수
있습니다. 이미지 20개·공개 10개, 동영상 3개·공개 1개 제한은 API에서
검증합니다.

매물 미디어는 `multipart/form-data`의 `file` 필드로 직접 업로드합니다.
이미지는 최대 20MB이며 최대 2,048px WebP와 640×480 JPEG 썸네일로
변환됩니다. 동영상은 최대 500MB·3분이며 H.264/AAC MP4로 압축하고 JPEG
썸네일을 생성합니다. 로컬 기본 저장 위치는 `/tmp/lifehome-media`이고
운영 환경에서는 `MEDIA_STORAGE_ROOT`를 영속 볼륨으로 지정해야 합니다.
동영상 처리에는 `ffmpeg`와 `ffprobe`가 필요합니다.

일반 회원은 활성 매물을 허위 정보·중복·거래 불가·사기 의심 등의 사유로
신고할 수 있습니다. 관리자는 신고를 검토 중·처리 완료·기각으로 전환하고,
처리 완료 시 해당 매물을 비활성화할 수 있습니다. 모든 검수 단계는 별도
이력과 감사 로그에 기록됩니다.

환율은 외부 공급자의 최신 기준 환율을 15분간 캐시하며, 공급자 장애 시 7일
이내의 마지막 정상값을 `isStale=true`로 반환합니다. `GET /v1/properties`와
`GET /v1/properties/:id`에 `displayCurrency=USD`처럼 표시 통화를 지정하면
원래 가격과 함께 변환 가격, 적용 환율, 기준 시각이 반환됩니다. 지원 통화는
KRW, USD, EUR, CNY, JPY, GBP, CAD, AUD, SGD, HKD입니다.

기본 Frankfurter 공급자는 중앙은행의 최신 기준 환율을 제공하므로 화면 표시용
이며 결제·정산용 체결 환율이 아닙니다. 상용 실시간 공급자를 사용할 때는
`EXCHANGE_RATE_PROVIDER_URL`을 동일 응답 계약의 프록시 또는 자체 어댑터로
지정합니다.

방문 예약은 휴대폰 본인인증을 마친 회원만 활성 매물에 요청할 수 있습니다.
방문은 최소 2시간 전, 30분 이상 3시간 이하, 90일 이내로 요청해야 합니다.
요청 상태에서는 절대 자동 확정되지 않으며 매물 등록자가 승인해야
`CONFIRMED`가 됩니다. 중개사 매물은 담당 중개사, 직거래 매물은 등록한
소유자·위임자가 거절하거나 대안 시간을 제안할 수 있고, 방문 회원이 대안을
직접 수락해야 확정됩니다.

상태는 `REQUESTED → CONFIRMED`, `REJECTED` 또는
`ALTERNATIVE_PROPOSED → CONFIRMED/ALTERNATIVE_DECLINED`로 전이됩니다.
회원 취소는 `CANCELLED`로 기록됩니다. 모든 전환은 예약 이력·감사 로그에
남고 상대방 알림은 `notification_outbox`에 원자적으로 적재됩니다.

여러 매물을 방문하기 전에는 `POST /v1/visit-route-plans/optimize`로 공개
매물 2~5개와 출발 좌표·시각을 전달해 방문 순서와 제안 일정을 계산할 수
있습니다. 최대 5개 매물의 전체 순열을 비교해 가장 짧은 동선을 선택하고,
자동차·대중교통·도보별 예상 이동시간, 매물별 방문 구간, 완료 희망 시각
충족 여부를 반환합니다. 휴대폰 본인인증이 필요하며 본인 매물이나 좌표가
없는 매물은 포함할 수 없습니다.

동선 결과는 Haversine 직선거리, 도로 보정계수와 교통수단별 평균속도를
사용한 예약 전 추정치입니다. 실시간 교통·도로 통제·대중교통 배차는 포함하지
않으며, 실제 예약은 제안된 시간마다 별도로 요청하고 각 매물 등록자의 승인을
받아야 확정됩니다.

알림 작업자는 아웃박스를 주기적으로 선점하여 FCM 푸시를 우선 전송하고,
활성 푸시 토큰이 없거나 모든 토큰이 영구 무효이면 인증된 국내 휴대폰으로
네이버 클라우드 SENS SMS를 대체 전송합니다. 앱의 FCM 토큰은
`POST /v1/notifications/push-endpoints`로 등록하며 AES-256-GCM 암호문과
검색용 키 해시만 저장합니다. API 응답과 로그에는 토큰·휴대폰 번호를
노출하지 않습니다.

아웃박스 상태는 `PENDING → PROCESSING → SENT`로 전이됩니다. 일시적 공급자
장애는 지수형 지연으로 최대 6회 재시도하고, 재시도 한도 또는 영구 오류는
`FAILED`로 종료합니다. 작업자 잠금에 만료 시간을 두어 프로세스가 중단되어도
다른 인스턴스가 미완료 작업을 복구할 수 있습니다.

개발 환경의 `PUSH_PROVIDER_MODE=log`, `SMS_PROVIDER_MODE=log`는 외부 전송 없이
흐름을 검증합니다. 운영 환경은 LOG 모드를 거부하며 FCM 서비스 계정과
SENS 서비스·IAM 키·등록 발신번호를 비밀 저장소에서 주입해야 합니다.

예약금은 확정된 방문 예약에만 준비할 수 있으며 기본 금액은 10,000원입니다.
결제 준비·승인은 16~100자의 `Idempotency-Key` 헤더를 요구하고, 예약별 결제
한 건과 거래 원장을 별도로 보존합니다. 결제가 `PAID`일 때만
`visitAccessGranted=true`가 됩니다.

회원이 방문 시작 전에 예약을 취소하면 환불 요청이 예약 취소와 같은
데이터베이스 트랜잭션에 생성되고 예약금 전액을 환불합니다. 환경변수로도
100% 미만 환불률을 설정할 수 없습니다. 공급자 환불이 실패하면
`REFUND_PENDING`과 실패 거래를 유지해 같은 멱등성 키로 재처리할 수 있습니다.
환불 요청에는 3일의 보수적인 내부 처리기한과 연체 상태가 기록됩니다.

`PAYMENT_PROVIDER_MODE=mock`은 로컬 개발 전용이며 운영 환경에서는 자동
거부됩니다. 운영 기본 PG는 `TOSS`, `NICEPAY`, `NHN_KCP` 중 하나를 선택합니다.
앱 설정에는 토스·나이스의 공개 클라이언트 키 또는 KCP 사이트 코드만 제공하고,
서버 시크릿·KCP 서비스 인증서·개인키는 절대 노출하지 않습니다.

- 토스페이먼츠: 서버 시크릿 인증, 승인·취소 멱등성 헤더, 공급자 재조회 검증
- 나이스페이: `clientKey:secretKey` Basic 인증, 승인·취소·조회 응답의
  `SHA-256(tid + amount + ediDate + secretKey)` 서명 검증
- NHN KCP: 서비스 인증서와 RSA-SHA256 개인키 서명, 승인·거래조회·전액/부분
  취소, 테스트·운영 호스트 분리

세 PG 웹훅은 공급자별 전송 ID 또는 본문 기반 결정적 해시로 중복 차단합니다.
본문만 신뢰하지 않고 공급자 API를 다시 조회해 주문번호·금액·통화·상태를
검증한 뒤 승인 응답 유실과 외부 환불 상태를 내부 원장에 재조정합니다.
웹훅 원문은 저장하지 않고 SHA-256 해시와 처리 결과만 기록합니다. KCP
`TX00` 웹훅은 성공 시 공급자 규격 그대로 `{"result":"0000"}`을 반환합니다.

KCP 운영 전환 시에는 운영 인증서·개인키를 비밀 저장소에서 Base64 환경변수로
주입하고, KCP가 안내한 운영·테스트 송신 IP를 방화벽 허용 목록에 반영해야
합니다. 실제 결제 전에는 각 PG 가맹점 계약, 심사, 테스트 상점 검증과 국내
전자금융·개인정보 처리 절차 확인이 필요합니다.

카드 가맹점 수수료는 회원에게 전가하지 않습니다. 환불률·정책 버전·동의
시각은 결제마다 스냅샷으로 저장하며, 0.8.0의 70% 정책 데이터는 마이그레이션
과정에서 100% 환불 정책으로 변경됩니다. 이미 부분 환불된 건은 잔여 30%를
추가 환불 대기로 전환합니다.

## 검증

```bash
npm run prisma:validate
npm run typecheck
npm run test
npm run build
```

Flutter SDK가 설치된 환경에서는 다음 명령으로 플랫폼 폴더를 생성하고 실행합니다.

```bash
cd apps/mobile
flutter create --platforms=android,ios .
flutter pub get
flutter run
```
