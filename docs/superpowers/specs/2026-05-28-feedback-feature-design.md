# 피드백 기능 설계 (2026-05-28)

## 배경

Phase 5 가족·친구 배포 직전. 초대받은 사용자가 개발자(colri25@gmail.com)에게 디자인/UX/시세 오류 등을 보고할 수 있는 채널이 필요하다. 가장 가벼운 형태: Supabase DB에 피드백을 누적, 개발자는 admin 페이지에서 카테고리별로 조회.

스코프 범위 밖 항목은 [Out of scope](#out-of-scope-yagni) 참고.

## 데이터 모델

### `feedback` 테이블

```sql
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  category    text not null check (category in
              ('design','ui','ux','price_data','other')),
  body        text not null check (char_length(body) between 1 and 2000),
  user_agent  text,
  page_url    text,
  created_at  timestamptz not null default now()
);

create index feedback_category_created_at_idx
  on public.feedback (category, created_at desc);
create index feedback_user_id_idx
  on public.feedback (user_id);
```

- `email` 컬럼: `auth.users.email`의 snapshot. 사용자 이메일이 바뀌어도 제출 시점 기록 보존, admin 조회 시 join 불필요.
- `user_agent` / `page_url`: nullable. 클라이언트가 전송 시 채움.

### RLS 정책

```sql
alter table public.feedback enable row level security;
alter table public.feedback force row level security;

create policy feedback_insert_own on public.feedback
  for insert with check (auth.uid() = user_id);

create policy feedback_select_own on public.feedback
  for select using (auth.uid() = user_id);
```

- INSERT/SELECT 모두 `auth.uid() = user_id`로 제한.
- admin 읽기는 **DB role이 아닌 server가 service_role로 처리** (다음 섹션).
- UPDATE/DELETE 정책 없음 → 사용자가 자기 피드백을 편집/철회할 수 없음 (의도된 제약, 변조 방지).

### 트리거: `user_id` 자동 주입

기존 `20260526000003_triggers.sql` + `20260526000004_trigger_guards.sql`의 `set_user_id_from_jwt()` 함수 재사용 — INSERT 시 `auth.uid()`를 `NEW.user_id`에 강제 주입(service_role 호출 시 `auth.uid()`가 null이면 클라이언트 제공값 유지하는 guard도 이미 적용됨). 클라이언트가 user_id 누락/위조해도 안전.

```sql
create trigger feedback_set_user_id
  before insert on public.feedback
  for each row execute function public.set_user_id_from_jwt();
```

UPDATE/DELETE 정책이 없으므로 immutable 가드 트리거는 불필요.

### 마이그레이션 파일

신규: `supabase/migrations/20260528000001_feedback.sql` — 테이블 + 인덱스 2개 + RLS enable/force + 정책 2개 + 트리거 1개.

기존 `20260526000004_trigger_guards.sql`의 service_role 가드(`auth.uid()=null` 시 user_id 덮어쓰지 않음)는 `set_user_id` 함수 자체에 이미 적용되어 있어 재사용 시 자동 적용됨.

Dashboard SQL Editor에서 수동 실행 (CLI 미설치, 기존 패턴).

## 서버

### 신규 라우트

#### `POST /api/feedback`

- 인증: 기존 JWT 미들웨어
- Rate limit: IP+user 결합 키로 분당 1건 (express-rate-limit `keyGenerator` 커스텀, 라우트 전용 인스턴스)
- zod 검증:
  ```ts
  {
    category: z.enum(['design','ui','ux','price_data','other']),
    body: z.string().min(1).max(2000),
    page_url: z.string().max(500).optional(),
  }
  ```
- 처리:
  - `user_agent` = `req.headers['user-agent']?.slice(0, 1000)`
  - `email` = `req.user.email`
  - service_role client로 insert (트리거가 user_id 채움)
- 응답: `201 { id }`

#### `GET /api/admin/feedback`

- 인증: 기존 JWT 미들웨어 + 신규 `requireAdmin` 미들웨어
- 쿼리 파라미터:
  - `category` (optional): 위 5개 중 하나, 미지정 시 전체
  - `limit` (optional, default 50, max 200)
  - `offset` (optional, default 0)
- 처리: service_role select, `category` 일치 + `created_at desc`
- 응답:
  ```json
  {
    "items": [{ "id", "email", "category", "body", "user_agent", "page_url", "created_at" }],
    "counts": { "design": N, "ui": N, "ux": N, "price_data": N, "other": N, "total": N }
  }
  ```
  `counts`는 카테고리 탭 배지용. 단일 `select category, count(*) ... group by category` 1회 + 결과를 5개 키로 펼침 (`(category, created_at)` 인덱스로 인덱스-only scan 가능).

### 신규 미들웨어 `requireAdmin`

`server/middleware/requireAdmin.js`:

```js
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function requireAdmin(req, res, next) {
  if (ADMIN_EMAILS.length === 0) {
    return res.status(503).json({ error: 'admin_disabled' });
  }
  const email = req.user?.email?.toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}
```

- `ADMIN_EMAILS` 빈 값이면 admin 라우트 자체가 503 (오타 등으로 모든 사용자에게 admin 권한 주는 사고 방지)
- 이메일 소문자 정규화 (Supabase auth는 lowercase 저장하지만 안전장치)

### Env 변수

`server/.env.example` 추가:
```
ADMIN_EMAILS=colri25@gmail.com
```

## 클라이언트

### 피드백 버튼 위치

`AssetDashboard.jsx` 최하단, 기존 `<footer>` (현재 `contentinfo`) 바로 위에 배치. 화면 가장 아래에 보이도록.

스타일: 헤더 outline 버튼 (e.g. "내보내기") 톤. lucide `MessageSquare` 아이콘 + "피드백 보내기" 텍스트. 가운데 정렬.

### 카테고리 라벨 매핑

DB/API는 영어 키, UI는 한국어 라벨. 클라이언트 한 곳에서 매핑 객체 관리:

```js
// lib/feedback.js
export const FEEDBACK_CATEGORIES = [
  { key: 'design',     label: '디자인' },
  { key: 'ui',         label: 'UI' },
  { key: 'ux',         label: 'UX' },
  { key: 'price_data', label: '시세 오류' },
  { key: 'other',      label: '기타' },
];
```

FeedbackModal과 AdminFeedbackPage 양쪽에서 동일 객체 사용.

### `FeedbackModal.jsx` (신규)

기존 `AddModal` / `TargetModal` 패턴:
- `div.z-50` 오버레이
- 헤더: `<h2>피드백 보내기</h2>` + X 버튼
- 본문:
  - 카테고리 라디오 5개 (가로 배치, active 강조)
    ```
    [ ] 디자인  [ ] UI  [ ] UX  [ ] 시세 오류  [ ] 기타
    ```
  - 텍스트영역 (`rows={6}`, placeholder "어떤 점이 불편하셨나요?")
  - 카운터 "N / 2000자"
- 푸터: `취소` 버튼 + `SEND` 버튼 (영문 그대로, 사용자 지정)
- 상태:
  - submitting: SEND → "전송 중…" + disabled (Phase 4 fix 패턴: async submit + await)
  - 성공: 모달 안에 "감사합니다 ✓" 1.5s 표시 후 자동 close + form reset
  - 실패: textarea 위에 빨간 inline 에러 (`에러 메시지`)

검증:
- 카테고리 미선택 → SEND 비활성
- body 빈 문자열 → SEND 비활성
- body > 2000자 → 카운터 빨갛게, SEND 비활성

### `lib/api.js`에 함수 추가

```js
export async function submitFeedback({ category, body }) {
  return apiPost('/api/feedback', {
    category,
    body,
    page_url: window.location.href,
  });
}
```

### Admin 페이지 `AdminFeedbackPage.jsx` (신규)

라우트: 해시 라우터 `#/admin/feedback`. 현재 react-router-dom 없음 → 작은 `useHashRoute` 훅 (15줄) `lib/useHashRoute.js`에 추가.

`AssetDashboard`의 `main.jsx` 진입점에서:
```jsx
<AuthProvider>
  <AuthGate>
    {route === '/admin/feedback'
      ? <AdminFeedbackPage />
      : <AssetDashboard />}
  </AuthGate>
</AuthProvider>
```

#### Admin 페이지 권한 게이트

```js
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = ADMIN_EMAILS.includes(user.email?.toLowerCase());
if (!isAdmin) return <NotAuthorized />; // 대시보드로 돌아가는 링크
```

**클라이언트 게이트는 UI 가림용일 뿐, 진짜 권한은 서버 `requireAdmin`.**

#### Admin 페이지 레이아웃

```
[← 대시보드로]                  Admin · 피드백

[전체 N] [디자인 N] [UI N] [UX N] [시세 오류 N] [기타 N]

┌──────────────────────────────────────────────────┐
│ user@example.com · 2026-05-28 21:34 · 디자인       │
│ Mozilla/5.0 ... Mobile Safari ... · /#/            │
├──────────────────────────────────────────────────┤
│ 본문 텍스트 (whitespace-pre-wrap)                  │
└──────────────────────────────────────────────────┘

[더 보기]    (offset += 50)
```

탭 클릭 시 `?category=ui` 쿼리 → fetch + 리스트 갱신.

### 헤더 진입 링크

`AssetDashboard` 헤더의 "colri25@gmail.com · 로그아웃" 버튼 옆에 admin만 보이는 "Admin" 링크 (`href="#/admin/feedback"`).

### Env 변수

`client/.env.example` 추가:
```
VITE_ADMIN_EMAILS=colri25@gmail.com
```

## 보안 정리

1. **DB 레벨**: RLS로 사용자는 자기 것만 INSERT/SELECT.
2. **API 레벨**: `/api/admin/feedback`은 `requireAdmin` 미들웨어. `ADMIN_EMAILS` 빈 값이면 503 (fail-safe).
3. **클라이언트**: `VITE_ADMIN_EMAILS`는 UI 게이트일 뿐. 일반 사용자가 build 산출물 읽어 admin email을 알게 되어도, 그 이메일의 JWT가 없으면 서버가 거부.
4. **Rate limit**: 분당 1건. 욕설/스팸 폭주 방지.
5. **XSS**: React 자동 escape. user_agent / body 모두 텍스트로만 렌더, dangerouslySetInnerHTML 사용 안 함.
6. **PII**: email + user_agent는 PII성. 회원 탈퇴 시 cascade로 삭제 (FK on delete cascade).

## 테스트 전략

[[feedback-skip-tdd-ceremony]] 메모리에 따라 순수 함수에만 단위 테스트.

- **신규 단위 테스트**: `server/middleware/requireAdmin.test.js`
  - no token + admin enabled → 403
  - valid non-admin token → 403
  - valid admin token → next()
  - `ADMIN_EMAILS` 빈 값 → 503
  - 다수 이메일 등록 시 부분 일치 통과
- **통합 검증**: `scripts/dogfood.js`에 시나리오 추가
  - 일반 user로 `POST /api/feedback` 201 + DB row 확인
  - admin 이메일로 `GET /api/admin/feedback` 200, counts 정확성 확인
  - 비-admin user의 `GET /api/admin/feedback` 403
  - rate limit: 60초 내 2번째 요청 429
- **UI**: verify 스킬로 수동 검증 (피드백 제출 → admin 페이지에서 표시되는 것 직접 확인)

## 배포

1. **마이그레이션**: Dashboard SQL Editor에서 `20260528000001_feedback.sql` 실행
2. **서버 env**: Railway에 `ADMIN_EMAILS=colri25@gmail.com` 추가
3. **클라이언트 env**: Vercel에 `VITE_ADMIN_EMAILS=colri25@gmail.com` 추가
4. **빌드 grep**: dist 산출물에 `SERVICE_ROLE_KEY`/`JWT_SECRET` 0건 재확인 (기존 Phase 3 체크 재사용)

## Out of scope (YAGNI)

다음 기능은 의도적으로 제외. 필요해지면 별도 spec.

- **첨부파일/스크린샷 업로드**: Supabase Storage 추가 + RLS 추가 + 모달 UI 복잡도. 일단 텍스트로 충분.
- **답장/댓글 기능**: 개발자→사용자 회신. 이메일로 처리하거나 별도 기능으로 분리.
- **상태 워크플로**: open/in-progress/resolved 컬럼 + admin UI 토글. 가족·친구 규모에선 SQL `update` 한 줄로 충분.
- **이메일 알림**: 피드백 제출 시 admin에게 즉시 메일. Resend/SMTP 통합 필요. 일단 admin이 주기적으로 확인하는 방식.
- **Markdown 렌더링**: body 평문 텍스트로 충분.
- **사용자 피드백 이력 페이지**: 사용자가 자기 제출 이력 보는 UI. RLS는 SELECT 허용해 두지만 UI는 안 만듦.
- **다국어**: 한국어만 (사용자 모두 한국어).

## 관련 메모리·문서

- 멀티유저 롤아웃 spec: [`2026-05-26-multi-user-rollout-design.md`](./2026-05-26-multi-user-rollout-design.md)
- Phase 5 배포 의존성: [[project-multi-user-rollout-status]]
- TDD 적용 범위: [[feedback-skip-tdd-ceremony]]
- 보안 deferred 항목: [[project-multi-user-security-deferred]]
