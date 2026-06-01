# 모바일 UI 다듬기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5 배포 직전, 모바일(< 640px)에서 헤더 7개 버튼을 햄버거 + dropdown 패널로 정리하고 요약 카드 4개를 2x2 격자로 표시한다.

**Architecture:** `client/src/AssetDashboard.jsx` 단일 파일 수정. React `useState`로 dropdown 토글, Tailwind 반응형 클래스(`hidden sm:flex` / `sm:hidden`)로 데스크탑/모바일 분기. 컴포넌트 분리 없이 인라인 JSX 유지.

**Tech Stack:** React 18, Tailwind CSS, lucide-react (Menu/X 아이콘)

**Spec:** `docs/superpowers/specs/2026-06-01-mobile-ui-polish-design.md`

**참고 — 테스트 전략:** 순수 함수 변경이 없으므로 unit test 없음. Playwright 또는 수동 dev server로 viewport 통합 검증. (사용자 피드백 메모: UI/라우트/config는 통합 검증으로)

---

### Task 1: 헤더 햄버거 + dropdown 패널

**Files:**
- Modify: `client/src/AssetDashboard.jsx` (lucide import, state, 헤더 JSX 574-648줄 영역)

- [ ] **Step 1: lucide-react import에 `Menu` 추가**

`AssetDashboard.jsx:28` 부근, 기존 lucide import 블록에 `Menu` 추가:

```jsx
import {
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  TrendingDown,
  Target,
  Wallet,
  X,
  AlertCircle,
  CheckCircle2,
  Download,
  Upload,
  RotateCcw,
  Pencil,
  Menu,
  ArrowDownCircle,
  ArrowUpCircle,
  History,
  MessageSquare,
} from "lucide-react";
```

(`X`는 이미 import되어 있으므로 그대로 둠. `Menu`만 추가.)

- [ ] **Step 2: `mobileMenuOpen` state 추가**

`AssetDashboard.jsx:203-207` 부근, 다른 `useState(false)` 선언 옆에 추가:

```jsx
const [showAdd, setShowAdd] = useState(false);
const [showTarget, setShowTarget] = useState(false);
const [showFeedback, setShowFeedback] = useState(false);
const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
```

- [ ] **Step 3: 기존 버튼 그룹을 `hidden sm:flex`로 변경 (데스크탑만 노출)**

`AssetDashboard.jsx:584`의 우측 버튼 그룹 div:

```jsx
<div className="flex items-center gap-2 flex-wrap">
```

→

```jsx
<div className="hidden sm:flex items-center gap-2 flex-wrap">
```

(이 div 안의 7개 버튼 + `<input type="file" hidden>`은 그대로 유지)

- [ ] **Step 4: 햄버거 버튼 추가 (모바일만 노출)**

위 Step 3에서 수정한 `<div className="hidden sm:flex ...">` **바로 위**(같은 `<header>` 안)에 햄버거 버튼 추가. 파일 input은 그 div 안에 있으므로 햄버거가 모바일에서 trigger하려면 ref를 외부에서도 접근 가능하게 그대로 두고, "가져오기" 항목이 `fileInputRef.current?.click()`을 직접 호출.

**먼저 `<input ref={fileInputRef} ...>`만 div 밖으로 옮긴다** (헤더 직속 child로). 이렇게 해야 모바일에서도 dropdown 항목에서 ref 접근이 자연스럽고, 데스크탑/모바일 모두 같은 input을 공유.

`AssetDashboard.jsx:599-605` 의 input을:

```jsx
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={importJSON}
            />
```

기존 위치에서 잘라내어 `<header className="...">` 직속(584 div의 형제) — 예: `<header>` 닫는 태그 직전에 둔다. 또는 더 안전하게 `<div className="flex items-center gap-2 flex-wrap">` 옆에 둔다.

**그 다음 햄버거 버튼 JSX 추가** — 우측 div 영역(584줄 div 시작 전, 또는 같은 라인 옆)에 모바일 전용으로:

```jsx
<button
  onClick={() => setMobileMenuOpen((v) => !v)}
  className="sm:hidden flex items-center justify-center w-10 h-10 rounded-full border border-slate-700 hover:border-slate-500 transition"
  aria-label={mobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
>
  {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
</button>
```

최종 헤더 우측 영역 구조:

```jsx
<header className="flex items-end justify-between mb-10 gap-4 flex-wrap">
  <div>
    {/* 제목 영역 그대로 */}
  </div>

  {/* 햄버거 (모바일) */}
  <button
    onClick={() => setMobileMenuOpen((v) => !v)}
    className="sm:hidden flex items-center justify-center w-10 h-10 rounded-full border border-slate-700 hover:border-slate-500 transition"
    aria-label={mobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
  >
    {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
  </button>

  {/* 데스크탑 가로 정렬 (sm 이상) */}
  <div className="hidden sm:flex items-center gap-2 flex-wrap">
    {/* 기존 7개 버튼 그대로 */}
  </div>

  {/* 공유 파일 input */}
  <input
    ref={fileInputRef}
    type="file"
    accept="application/json"
    className="hidden"
    onChange={importJSON}
  />
</header>
```

- [ ] **Step 5: dropdown 패널 JSX 추가**

`</header>` 닫는 태그 **바로 아래**(648줄 직후, "마지막 업데이트" div 651줄 직전)에 dropdown 패널 추가:

```jsx
{/* 모바일 메뉴 dropdown */}
{mobileMenuOpen && (
  <div className="sm:hidden bg-slate-900/95 border border-slate-800 rounded-2xl p-2 mb-6 flex flex-col">
    <button
      onClick={() => { exportJSON(); setMobileMenuOpen(false); }}
      className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-slate-800 w-full text-left transition"
    >
      <Download size={14} /> 내보내기
    </button>
    <button
      onClick={() => { fileInputRef.current?.click(); setMobileMenuOpen(false); }}
      className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-slate-800 w-full text-left transition"
    >
      <Upload size={14} /> 가져오기
    </button>
    <button
      onClick={() => { resetAllData(); setMobileMenuOpen(false); }}
      className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-rose-300 hover:bg-rose-500/10 w-full text-left transition"
    >
      <RotateCcw size={14} /> 초기화
    </button>
    <button
      onClick={() => { setShowTarget(true); setMobileMenuOpen(false); }}
      className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-slate-800 w-full text-left transition"
    >
      <Target size={14} /> 목표 배분
    </button>
    <button
      onClick={() => { refreshAll(); setMobileMenuOpen(false); }}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-slate-100 text-slate-900 hover:bg-white font-medium w-full text-left transition disabled:opacity-50 mt-1"
    >
      <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
      {loading ? "조회중..." : "시세 새로고침"}
    </button>
    {user && (
      <>
        {isAdminEmail(user.email) && (
          <button
            onClick={() => { navigate("/admin/feedback"); setMobileMenuOpen(false); }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-amber-400 hover:bg-amber-500/10 w-full text-left transition mt-1"
          >
            Admin
          </button>
        )}
        <button
          onClick={() => { signOut(); setMobileMenuOpen(false); }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs hover:bg-slate-800 w-full text-left transition border-t border-slate-800 mt-1 pt-3"
        >
          {user.email} · 로그아웃
        </button>
      </>
    )}
  </div>
)}
```

- [ ] **Step 6: dev server에서 375px viewport로 수동 확인**

Run: `npm run dev --prefix client` (이미 떠있으면 새 탭 새로고침)

브라우저 DevTools → 모바일 모드 → iPhone SE (375x667) 또는 임의 375px 폭:

- 헤더 우측에 햄버거 아이콘만 보임. 데스크탑 버튼 그룹 안 보임
- 햄버거 탭 → 아이콘이 X로 바뀌고, 헤더 아래에 dropdown 노출
- dropdown에서 "가져오기" 탭 → 파일 다이얼로그 열림
- dropdown에서 "시세 새로고침" 탭 → dropdown 닫히고 refresh 시작
- 햄버거(X) 다시 탭 → dropdown 닫힘

Expected: 위 4가지 동작 모두 OK. 화면 캡처 첨부.

- [ ] **Step 7: 640px / 768px 회귀 확인**

같은 dev server에서 viewport 폭을 640px → 768px로 단계적 변경:

- 640px: 햄버거 사라지고 기존 가로 정렬 버튼 7개 노출
- 768px: 동일하게 가로 정렬

Expected: 데스크탑 영역에 회귀 없음.

- [ ] **Step 8: Commit**

```bash
git add client/src/AssetDashboard.jsx
git commit -m "feat(client): 모바일 헤더 햄버거 메뉴 (< sm)

sm 미만에서 7개 헤더 버튼을 햄버거 + dropdown 패널로 정리.
sm 이상은 기존 가로 정렬 유지. 파일 input을 헤더 최상위로
이동해 모바일/데스크탑 공용.

Spec: docs/superpowers/specs/2026-06-01-mobile-ui-polish-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 요약 카드 2x2 grid (모바일)

**Files:**
- Modify: `client/src/AssetDashboard.jsx:675` (단일 라인)

- [ ] **Step 1: grid class 변경**

`AssetDashboard.jsx:675`:

```jsx
<section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-12">
```

→

```jsx
<section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
```

- [ ] **Step 2: 375px viewport에서 수동 확인**

같은 dev server 새로고침, 375px 폭:

- 요약 카드 4개가 2x2 격자로 보임
- "총 자산 (KRW 환산)"의 큰 금액(예: ₩123,456,789)이 카드 안에서 잘리지 않고 표시
- 텍스트가 너무 작거나 줄바꿈 어색하면 step 3 진행, OK면 skip

Expected: 2x2 격자 OK.

- [ ] **Step 3 (조건부): 카드 폰트 모바일 축소**

Step 2에서 큰 금액이 카드 폭을 넘어 잘림/줄바꿈 어색한 경우에만 진행. `SummaryCard` 컴포넌트(`AssetDashboard.jsx:1084`)의:

```jsx
<div className={`font-display text-3xl tabular ${toneClass}`}>
```

→

```jsx
<div className={`font-display text-2xl sm:text-3xl tabular ${toneClass}`}>
```

(Step 2에서 OK면 이 step skip — `git diff`에 포함되지 않음)

- [ ] **Step 4: 768px 회귀 확인**

768px 폭에서 카드 1x4 가로 정렬 유지 — 회귀 없음.

- [ ] **Step 5: Commit**

```bash
git add client/src/AssetDashboard.jsx
git commit -m "feat(client): 요약 카드 모바일 2x2 grid

grid-cols-1 → grid-cols-2 (md 이상은 1x4 그대로). 모바일에서
글자 크기 유지하면서 4개 카드를 2x2 격자로 표시.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 최종 회귀 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: Admin 가시성 확인**

Admin 계정(`colri25@gmail.com`)으로 로그인 후 375px viewport:

- 햄버거 → dropdown에 "Admin" 항목 보임

비-Admin 계정으로 로그인 후 같은 viewport:

- 햄버거 → dropdown에 "Admin" 항목 안 보임 (다른 6개 + 로그아웃)

Expected: `isAdminEmail` 분기 동작 OK.

- [ ] **Step 2: 로딩 상태 확인**

dropdown에서 "시세 새로고침" 탭 → dropdown은 즉시 닫힘. "마지막 업데이트" 영역의 텍스트가 새 시간으로 업데이트되는 것 확인. 단순 회귀 체크.

- [ ] **Step 3: 콘솔 에러 확인**

브라우저 콘솔에 React warning/error 없는지 확인 (특히 key prop, controlled input 등).

Expected: 콘솔 clean.

- [ ] **Step 4 (선택): Playwright 자동 캡처**

선택사항 — Playwright MCP로 자동화하려면:

```
mcp__plugin_playwright_playwright__browser_resize (375 x 667)
mcp__plugin_playwright_playwright__browser_navigate (http://localhost:5173)
mcp__plugin_playwright_playwright__browser_take_screenshot
```

스크린샷 첨부.

---

## Self-Review

(작성 후 fresh-eyes 검토)

- **Spec coverage:** 헤더 햄버거 ✓ Task 1, 카드 2x2 ✓ Task 2, 검증 ✓ Task 3. 범위 밖 항목(외부 클릭/Esc/애니메이션)은 명시적으로 제외.
- **Placeholder scan:** TBD/TODO 없음. 모든 step에 실제 코드 또는 명령 포함.
- **Type consistency:** `mobileMenuOpen`, `setMobileMenuOpen`, `fileInputRef`, `isAdminEmail` 모두 일관성 있게 사용. `Menu`/`X` 아이콘 이름 정확.
- **TDD note:** 사용자 피드백에 따라 UI 통합 검증 채택 — Task 1 step 6/7, Task 2 step 2, Task 3 전체가 검증 역할.
