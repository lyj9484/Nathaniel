# Asset Dashboard Phase 0 + 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the single-file `C:\dev\asset_dashboard.jsx` into a Vite + React project, then add `localStorage` persistence (custom hook, JSON backup/restore, reset).

**Architecture:** Vite + React 18 + Tailwind v3. Custom `useLocalStorage` hook wraps `useState`. Storage keys use the `asset_dashboard_v1_` namespace, with `meta.schemaVersion` tracking data-shape evolution (this plan delivers `schemaVersion: 1`; Phase 2 will migrate to 2). Pure-function helpers for export/import/reset live in `src/lib/storage.js` and are unit-tested with Vitest. UI integration in `AssetDashboard.jsx` is verified manually via `npm run dev`.

**Tech Stack:** Node.js, Vite, React 18, Tailwind CSS v3, Recharts, lucide-react, Vitest, @testing-library/react.

**Spec:** `C:\dev\docs\superpowers\specs\2026-05-25-asset-dashboard-phase1to3-design.md` (sections 2, 3, 4)

**Working directory:** All `cd` commands assume PowerShell. After scaffolding, the working directory for npm/git/vitest commands is `C:\dev\asset-dashboard\`. The agent should run all commands without manually prepending `cd` — instead pass absolute paths to npm via `--prefix` or use the `Bash`/`PowerShell` tool's working directory feature. Where commands are listed below as `npm ...`, they assume you are inside `C:\dev\asset-dashboard\`.

---

## File Structure (end state of this plan)

```
C:\dev\asset-dashboard\
  .git/                       (new, scoped to this project only)
  package.json
  vite.config.js
  tailwind.config.js
  postcss.config.js
  vitest.config.js
  index.html
  src/
    main.jsx
    App.jsx
    AssetDashboard.jsx        (was C:\dev\asset_dashboard.jsx, modified for hooks + header buttons)
    constants.js              (CATEGORIES, SAMPLE, DEFAULT_TARGET)
    setupTests.js             (jsdom setup)
    hooks/
      useLocalStorage.js
      useLocalStorage.test.js
    lib/
      format.js               (formatNumber, formatKRW)
      yahoo.js                (fetchYahooPrice)
      storage.js              (STORAGE_KEYS, exportAll, importAll, resetAll, validateBackup)
      storage.test.js
    components/
      AddHoldingModal.jsx
      TargetModal.jsx
      StorageButtons.jsx      (백업 / 불러오기 / 초기화 헤더 버튼 묶음)
  index.css                   (Tailwind directives + font imports)
```

The original `C:\dev\asset_dashboard.jsx` is **left in place** as a reference until Phase 1 is verified working in the new project. It will be removed in a later cleanup task.

---

## Task 1: Scaffold Vite + React project

**Files:**
- Create: `C:\dev\asset-dashboard\` (entire project tree from Vite template)

- [ ] **Step 1: Verify Node.js is installed**

Run: `node --version`
Expected: `v18.x.x` or higher. If not installed, install Node.js LTS from nodejs.org before continuing.

- [ ] **Step 2: Scaffold the project**

From `C:\dev\`, run:
```powershell
npm create vite@latest asset-dashboard -- --template react
```

When prompted (if any), accept defaults. This creates `C:\dev\asset-dashboard\` with the standard Vite React-JS template.

- [ ] **Step 3: Install base dependencies**

From `C:\dev\asset-dashboard\`:
```powershell
npm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 4: Verify the template runs**

From `C:\dev\asset-dashboard\`:
```powershell
npm run dev
```

Expected: Vite prints `Local: http://localhost:5173/`. Open in browser — the default Vite + React splash page (counter button) renders. Stop the server with `Ctrl+C`.

- [ ] **Step 5: Initialize git inside the project**

```powershell
git init
git add -A
git commit -m "chore: scaffold Vite React project"
```

Expected: A single initial commit. The repo is scoped to `C:\dev\asset-dashboard\` and does not touch `C:\dev\galaga.html` or `C:\dev\가계부\`.

---

## Task 2: Install runtime + dev dependencies

**Files:**
- Modify: `C:\dev\asset-dashboard\package.json`

- [ ] **Step 1: Install runtime deps**

```powershell
npm install recharts lucide-react
```

Expected: `package.json` `dependencies` includes `recharts` and `lucide-react`.

- [ ] **Step 2: Install Tailwind v3 + PostCSS + Autoprefixer (dev deps)**

```powershell
npm install -D tailwindcss@3 postcss autoprefixer
```

Tailwind v3 explicitly pinned — v4 has different config syntax and we want a known-good path.

- [ ] **Step 3: Install Vitest + Testing Library + jsdom (dev deps)**

```powershell
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m "chore: install runtime and dev dependencies"
```

---

## Task 3: Configure Tailwind + index.html

**Files:**
- Create: `C:\dev\asset-dashboard\tailwind.config.js`
- Create: `C:\dev\asset-dashboard\postcss.config.js`
- Modify: `C:\dev\asset-dashboard\src\index.css` (replace contents)
- Modify: `C:\dev\asset-dashboard\index.html` (add font links to `<head>`)

- [ ] **Step 1: Generate Tailwind + PostCSS config**

```powershell
npx tailwindcss init -p
```

Expected: `tailwind.config.js` and `postcss.config.js` created.

- [ ] **Step 2: Update Tailwind config content paths**

Open `C:\dev\asset-dashboard\tailwind.config.js` and replace its contents with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 3: Replace src/index.css**

Open `C:\dev\asset-dashboard\src\index.css` and replace its entire contents with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

.font-display { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
.font-sans { font-family: 'DM Sans', system-ui, sans-serif; }
.tabular { font-variant-numeric: tabular-nums; }
.grain::before {
  content: '';
  position: fixed; inset: 0; pointer-events: none; opacity: 0.025;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  z-index: 100;
}
```

This pulls the inline `<style>` block out of the original component into the global CSS where it belongs.

- [ ] **Step 4: Add font links to index.html**

Open `C:\dev\asset-dashboard\index.html` and add inside `<head>`, after the existing `<link>` for the icon:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 5: Replace App.css with empty file (template noise)**

Open `C:\dev\asset-dashboard\src\App.css` and replace its entire contents with a single comment:

```css
/* Tailwind utilities are loaded via index.css. */
```

- [ ] **Step 6: Verify Tailwind works**

Edit `C:\dev\asset-dashboard\src\App.jsx`. Replace its entire contents with:

```jsx
export default function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-amber-400 flex items-center justify-center font-display text-4xl">
      Tailwind OK
    </div>
  );
}
```

Run `npm run dev` and confirm a dark page with amber serif text appears at `http://localhost:5173/`. Stop the server.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "chore: configure Tailwind, fonts, and global styles"
```

---

## Task 4: Move and split the original component

**Files:**
- Create: `C:\dev\asset-dashboard\src\constants.js`
- Create: `C:\dev\asset-dashboard\src\lib\format.js`
- Create: `C:\dev\asset-dashboard\src\lib\yahoo.js`
- Create: `C:\dev\asset-dashboard\src\components\AddHoldingModal.jsx`
- Create: `C:\dev\asset-dashboard\src\components\TargetModal.jsx`
- Create: `C:\dev\asset-dashboard\src\AssetDashboard.jsx`
- Modify: `C:\dev\asset-dashboard\src\App.jsx` (mount AssetDashboard)

This task is mechanical extraction. No behavior changes. Source: `C:\dev\asset_dashboard.jsx`.

- [ ] **Step 1: Create src/constants.js**

Create `C:\dev\asset-dashboard\src\constants.js`:

```js
export const CATEGORIES = {
  kr: { label: "국장", color: "#60a5fa", suffix: "₩", locale: "ko-KR" },
  us: { label: "미장", color: "#f472b6", suffix: "$", locale: "en-US" },
  crypto: { label: "코인", color: "#fbbf24", suffix: "$", locale: "en-US" },
};

export const SAMPLE = [
  { id: 1, category: "kr", symbol: "005930.KS", name: "삼성전자", quantity: 50, avgPrice: 68000, currentPrice: null },
  { id: 2, category: "kr", symbol: "035720.KS", name: "카카오", quantity: 30, avgPrice: 52000, currentPrice: null },
  { id: 3, category: "us", symbol: "AAPL", name: "Apple", quantity: 10, avgPrice: 175.5, currentPrice: null },
  { id: 4, category: "us", symbol: "NVDA", name: "NVIDIA", quantity: 5, avgPrice: 480, currentPrice: null },
  { id: 5, category: "crypto", symbol: "BTC-USD", name: "Bitcoin", quantity: 0.05, avgPrice: 62000, currentPrice: null },
  { id: 6, category: "crypto", symbol: "ETH-USD", name: "Ethereum", quantity: 0.8, avgPrice: 3200, currentPrice: null },
];

export const DEFAULT_TARGET = { kr: 30, us: 50, crypto: 20 };
```

- [ ] **Step 2: Create src/lib/format.js**

Create `C:\dev\asset-dashboard\src\lib\format.js`:

```js
export function formatNumber(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatKRW(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return "₩" + Math.round(n).toLocaleString("ko-KR");
}
```

- [ ] **Step 3: Create src/lib/yahoo.js**

Create `C:\dev\asset-dashboard\src\lib\yahoo.js`:

```js
export async function fetchYahooPrice(symbol) {
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const proxied = `https://corsproxy.io/?${encodeURIComponent(upstream)}`;
  const res = await fetch(proxied);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (price == null) throw new Error("price not found");
  return price;
}
```

- [ ] **Step 4: Create AddHoldingModal**

Create `C:\dev\asset-dashboard\src\components\AddHoldingModal.jsx` by copying the `AddModal` function from the original `C:\dev\asset_dashboard.jsx` (lines ~567–693), renaming it to `AddHoldingModal`. Add at the top:

```jsx
import React, { useState } from "react";
import { X } from "lucide-react";
import { CATEGORIES } from "../constants.js";

export default function AddHoldingModal({ onClose, onAdd }) {
  // ... paste the body of AddModal from the original file unchanged ...
}
```

The body is identical to the original `AddModal` function body. Do not change behavior.

- [ ] **Step 5: Create TargetModal**

Create `C:\dev\asset-dashboard\src\components\TargetModal.jsx` by copying the `TargetModal` function from the original `C:\dev\asset_dashboard.jsx` (lines ~696–758):

```jsx
import React, { useState } from "react";
import { X } from "lucide-react";
import { CATEGORIES } from "../constants.js";

export default function TargetModal({ target, onClose, onSave }) {
  // ... paste the body of TargetModal from the original file unchanged ...
}
```

- [ ] **Step 6: Create AssetDashboard.jsx**

Create `C:\dev\asset-dashboard\src\AssetDashboard.jsx`. Copy the default-exported `AssetDashboard` function from the original file (lines 1–564), but:

1. Replace the top imports with:
   ```jsx
   import React, { useState, useMemo, useEffect } from "react";
   import {
     PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
   } from "recharts";
   import {
     Plus, RefreshCw, Trash2, TrendingUp, TrendingDown,
     Target, Wallet, AlertCircle, CheckCircle2,
   } from "lucide-react";
   import { CATEGORIES, SAMPLE, DEFAULT_TARGET } from "./constants.js";
   import { formatNumber, formatKRW } from "./lib/format.js";
   import { fetchYahooPrice } from "./lib/yahoo.js";
   import AddHoldingModal from "./components/AddHoldingModal.jsx";
   import TargetModal from "./components/TargetModal.jsx";
   ```

2. Delete the original `formatNumber`, `formatKRW`, `fetchYahooPrice`, and the `AddModal` / `TargetModal` function definitions.

3. In the JSX, the inline `<style>` block (with the `@import url(...)` for fonts and `.grain` etc.) is removed — those styles now live in `src/index.css`. Keep the `<div className="grain" />` div.

4. Change `<AddModal ... />` references to `<AddHoldingModal ... />`.

5. The default export is still `export default function AssetDashboard()`.

- [ ] **Step 7: Update App.jsx to mount AssetDashboard**

Replace `C:\dev\asset-dashboard\src\App.jsx` entirely with:

```jsx
import AssetDashboard from "./AssetDashboard.jsx";

export default function App() {
  return <AssetDashboard />;
}
```

- [ ] **Step 8: Verify visual parity**

Run `npm run dev`. Open `http://localhost:5173/`. Compare side-by-side with original `C:\dev\asset_dashboard.jsx` rendering (if available). Expected: identical layout, fonts, colors. The SAMPLE holdings appear, "시세 새로고침" attempts to fetch prices (may succeed or fail depending on CORS proxy availability — failures show in the amber error chip but UI is otherwise functional).

If anything visually differs (broken layout, missing fonts, missing icons), the most likely cause is:
- Missing import → check browser console
- Tailwind class not matched → confirm `tailwind.config.js` content globs cover the file
- Inline style block not removed properly → check the source

Stop the server.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "feat: split AssetDashboard into components and lib modules"
```

---

## Task 5: Set up Vitest

**Files:**
- Create: `C:\dev\asset-dashboard\vitest.config.js`
- Create: `C:\dev\asset-dashboard\src\setupTests.js`
- Modify: `C:\dev\asset-dashboard\package.json` (add `test` script)

- [ ] **Step 1: Create vitest.config.js**

Create `C:\dev\asset-dashboard\vitest.config.js`:

```js
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.js"],
    globals: true,
  },
});
```

- [ ] **Step 2: Create setupTests.js**

Create `C:\dev\asset-dashboard\src\setupTests.js`:

```js
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Add test script to package.json**

Open `C:\dev\asset-dashboard\package.json`. In the `scripts` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

So `scripts` looks like:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Smoke-test Vitest with a trivial test**

Create `C:\dev\asset-dashboard\src\lib\smoke.test.js`:

```js
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: `1 passed (1)`. If Vitest can't find `vitest/config` or react plugin, the install command in Task 2 didn't complete — re-run.

- [ ] **Step 5: Delete the smoke test**

```powershell
Remove-Item C:\dev\asset-dashboard\src\lib\smoke.test.js
```

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "chore: set up Vitest with jsdom and Testing Library"
```

---

## Task 6: Implement storage.js (keys, validation, export/import/reset)

**Files:**
- Create: `C:\dev\asset-dashboard\src\lib\storage.js`
- Create: `C:\dev\asset-dashboard\src\lib\storage.test.js`

This module owns the schema versioning, JSON backup/restore, and reset logic. Pure functions (taking a storage adapter) for testability.

- [ ] **Step 1: Write failing tests for STORAGE_KEYS and exportAll**

Create `C:\dev\asset-dashboard\src\lib\storage.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { STORAGE_KEYS, exportAll, importAll, resetAll, validateBackup } from "./storage.js";

describe("STORAGE_KEYS", () => {
  it("uses asset_dashboard_v1_ prefix for all keys", () => {
    Object.values(STORAGE_KEYS).forEach((k) => {
      expect(k.startsWith("asset_dashboard_v1_")).toBe(true);
    });
  });

  it("defines meta, holdings, transactions", () => {
    expect(STORAGE_KEYS.meta).toBe("asset_dashboard_v1_meta");
    expect(STORAGE_KEYS.holdings).toBe("asset_dashboard_v1_holdings");
    expect(STORAGE_KEYS.transactions).toBe("asset_dashboard_v1_transactions");
  });
});

describe("exportAll", () => {
  beforeEach(() => localStorage.clear());

  it("returns an object with schemaVersion and keys snapshot", () => {
    localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify({ schemaVersion: 1, fxRate: 1380, target: { kr: 30, us: 50, crypto: 20 } }));
    localStorage.setItem(STORAGE_KEYS.holdings, JSON.stringify([{ id: 1, symbol: "AAPL" }]));

    const out = exportAll();
    expect(out.schemaVersion).toBe(1);
    expect(out.exportedAt).toBeDefined();
    expect(out.keys[STORAGE_KEYS.meta]).toEqual({ schemaVersion: 1, fxRate: 1380, target: { kr: 30, us: 50, crypto: 20 } });
    expect(out.keys[STORAGE_KEYS.holdings]).toEqual([{ id: 1, symbol: "AAPL" }]);
  });

  it("includes only present keys (no nulls for missing)", () => {
    localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify({ schemaVersion: 1 }));
    const out = exportAll();
    expect(STORAGE_KEYS.holdings in out.keys).toBe(false);
    expect(STORAGE_KEYS.transactions in out.keys).toBe(false);
  });

  it("defaults schemaVersion to 1 when meta is missing", () => {
    const out = exportAll();
    expect(out.schemaVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests — they should fail**

Run: `npm test`
Expected: Cannot find `./storage.js` or `STORAGE_KEYS is undefined`. Failing.

- [ ] **Step 3: Implement STORAGE_KEYS and exportAll**

Create `C:\dev\asset-dashboard\src\lib\storage.js`:

```js
export const KEY_PREFIX = "asset_dashboard_v1_";

export const STORAGE_KEYS = {
  meta: KEY_PREFIX + "meta",
  holdings: KEY_PREFIX + "holdings",
  transactions: KEY_PREFIX + "transactions",
};

export function exportAll() {
  const keys = {};
  Object.values(STORAGE_KEYS).forEach((k) => {
    const raw = localStorage.getItem(k);
    if (raw == null) return;
    try {
      keys[k] = JSON.parse(raw);
    } catch {
      // skip corrupted entries
    }
  });
  const metaParsed = keys[STORAGE_KEYS.meta];
  const schemaVersion = metaParsed?.schemaVersion ?? 1;
  return {
    schemaVersion,
    exportedAt: new Date().toISOString(),
    keys,
  };
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, reason: "not an object" };
  if (typeof obj.schemaVersion !== "number") return { ok: false, reason: "missing schemaVersion" };
  if (obj.schemaVersion > 1) {
    return { ok: false, reason: `schemaVersion ${obj.schemaVersion} is newer than this app supports (max 1)` };
  }
  if (!obj.keys || typeof obj.keys !== "object") return { ok: false, reason: "missing keys" };
  for (const k of Object.keys(obj.keys)) {
    if (!k.startsWith(KEY_PREFIX)) return { ok: false, reason: `unexpected key: ${k}` };
  }
  return { ok: true };
}

export function importAll(obj) {
  const v = validateBackup(obj);
  if (!v.ok) throw new Error(v.reason);
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
  Object.entries(obj.keys).forEach(([k, value]) => {
    localStorage.setItem(k, JSON.stringify(value));
  });
}

export function resetAll() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `npm test`
Expected: 4 passed (3 from STORAGE_KEYS describe, but wait let me recount — `STORAGE_KEYS uses prefix`, `STORAGE_KEYS defines meta/holdings/transactions`, `exportAll returns snapshot`, `exportAll includes only present keys`, `exportAll defaults schemaVersion`). 5 passing.

- [ ] **Step 5: Add tests for validateBackup and importAll**

Append to `C:\dev\asset-dashboard\src\lib\storage.test.js`:

```js
describe("validateBackup", () => {
  it("rejects non-objects", () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup("hi").ok).toBe(false);
    expect(validateBackup(42).ok).toBe(false);
  });

  it("rejects missing schemaVersion", () => {
    expect(validateBackup({ keys: {} }).ok).toBe(false);
  });

  it("rejects newer schemaVersion than supported", () => {
    const r = validateBackup({ schemaVersion: 2, keys: {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/newer/);
  });

  it("rejects unexpected keys", () => {
    const r = validateBackup({ schemaVersion: 1, keys: { other_app_key: 1 } });
    expect(r.ok).toBe(false);
  });

  it("accepts valid backup", () => {
    const r = validateBackup({
      schemaVersion: 1,
      keys: { [STORAGE_KEYS.meta]: { schemaVersion: 1 } },
    });
    expect(r.ok).toBe(true);
  });
});

describe("importAll", () => {
  beforeEach(() => localStorage.clear());

  it("replaces all asset_dashboard keys with backup contents", () => {
    localStorage.setItem(STORAGE_KEYS.holdings, JSON.stringify([{ id: 99 }]));
    importAll({
      schemaVersion: 1,
      keys: {
        [STORAGE_KEYS.meta]: { schemaVersion: 1, fxRate: 1500 },
        [STORAGE_KEYS.holdings]: [{ id: 1 }, { id: 2 }],
      },
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.meta))).toEqual({ schemaVersion: 1, fxRate: 1500 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.holdings))).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("removes keys not present in backup", () => {
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify([{ id: "old" }]));
    importAll({
      schemaVersion: 1,
      keys: { [STORAGE_KEYS.meta]: { schemaVersion: 1 } },
    });
    expect(localStorage.getItem(STORAGE_KEYS.transactions)).toBeNull();
  });

  it("throws on invalid backup", () => {
    expect(() => importAll({ schemaVersion: 99, keys: {} })).toThrow();
  });
});

describe("resetAll", () => {
  it("removes all asset_dashboard keys but leaves other localStorage entries", () => {
    localStorage.setItem(STORAGE_KEYS.meta, "x");
    localStorage.setItem(STORAGE_KEYS.holdings, "x");
    localStorage.setItem("unrelated_key", "keep me");
    resetAll();
    expect(localStorage.getItem(STORAGE_KEYS.meta)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.holdings)).toBeNull();
    expect(localStorage.getItem("unrelated_key")).toBe("keep me");
  });
});
```

- [ ] **Step 6: Run all tests — should pass**

Run: `npm test`
Expected: all storage tests pass (≈13).

- [ ] **Step 7: Commit**

```powershell
git add src/lib/storage.js src/lib/storage.test.js
git commit -m "feat: add storage module with export/import/reset and tests"
```

---

## Task 7: Implement useLocalStorage hook

**Files:**
- Create: `C:\dev\asset-dashboard\src\hooks\useLocalStorage.js`
- Create: `C:\dev\asset-dashboard\src\hooks\useLocalStorage.test.js`

- [ ] **Step 1: Write failing tests**

Create `C:\dev\asset-dashboard\src\hooks\useLocalStorage.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorage } from "./useLocalStorage.js";

describe("useLocalStorage", () => {
  beforeEach(() => localStorage.clear());

  it("returns initialValue when key is absent", () => {
    const { result } = renderHook(() => useLocalStorage("k1", { count: 0 }));
    expect(result.current[0]).toEqual({ count: 0 });
  });

  it("returns parsed value when key exists", () => {
    localStorage.setItem("k2", JSON.stringify({ count: 42 }));
    const { result } = renderHook(() => useLocalStorage("k2", { count: 0 }));
    expect(result.current[0]).toEqual({ count: 42 });
  });

  it("falls back to initialValue when JSON is corrupted", () => {
    localStorage.setItem("k3", "{not json");
    const { result } = renderHook(() => useLocalStorage("k3", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("persists updates to localStorage", () => {
    const { result } = renderHook(() => useLocalStorage("k4", 0));
    act(() => result.current[1](7));
    expect(JSON.parse(localStorage.getItem("k4"))).toBe(7);
    expect(result.current[0]).toBe(7);
  });

  it("supports functional updates", () => {
    const { result } = renderHook(() => useLocalStorage("k5", 10));
    act(() => result.current[1]((prev) => prev + 1));
    expect(result.current[0]).toBe(11);
    expect(JSON.parse(localStorage.getItem("k5"))).toBe(11);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `npm test`
Expected: Cannot find `./useLocalStorage.js`. Failing.

- [ ] **Step 3: Implement the hook**

Create `C:\dev\asset-dashboard\src\hooks\useLocalStorage.js`:

```js
import { useState, useEffect, useCallback } from "react";

export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initialValue;
      return JSON.parse(raw);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // QuotaExceeded etc. — silently drop; future work: surface toast
    }
  }, [key, value]);

  const set = useCallback((next) => {
    setValue((prev) => (typeof next === "function" ? next(prev) : next));
  }, []);

  return [value, set];
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `npm test`
Expected: 5 useLocalStorage tests pass, all earlier tests still pass.

- [ ] **Step 5: Commit**

```powershell
git add src/hooks/useLocalStorage.js src/hooks/useLocalStorage.test.js
git commit -m "feat: add useLocalStorage hook with corruption-safe fallback"
```

---

## Task 8: Integrate useLocalStorage into AssetDashboard

**Files:**
- Modify: `C:\dev\asset-dashboard\src\AssetDashboard.jsx`

Goal: replace three `useState` calls (`holdings`, `fxRate`, `target`) with `useLocalStorage`. Also write the `meta` blob (containing `fxRate` and `target`) atomically so JSON export sees a coherent snapshot.

Design note: We want `holdings` as its own key, and `fxRate` + `target` packed into `meta` (along with `schemaVersion`). Two effects, two keys.

- [ ] **Step 1: Add imports**

In `C:\dev\asset-dashboard\src\AssetDashboard.jsx`, add to the import block:

```jsx
import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { STORAGE_KEYS } from "./lib/storage.js";
```

- [ ] **Step 2: Replace holdings state**

Find:
```jsx
const [holdings, setHoldings] = useState(SAMPLE);
```

Replace with:
```jsx
const [holdings, setHoldings] = useLocalStorage(STORAGE_KEYS.holdings, SAMPLE);
```

- [ ] **Step 3: Replace meta (fxRate + target) state**

Find:
```jsx
const [fxRate, setFxRate] = useState(1380); // USD → KRW 기본값
const [target, setTarget] = useState(DEFAULT_TARGET);
```

Replace with:
```jsx
const [meta, setMeta] = useLocalStorage(STORAGE_KEYS.meta, {
  schemaVersion: 1,
  fxRate: 1380,
  target: DEFAULT_TARGET,
});
const fxRate = meta.fxRate;
const target = meta.target;
const setFxRate = (v) => setMeta((m) => ({ ...m, fxRate: typeof v === "function" ? v(m.fxRate) : v }));
const setTarget = (v) => setMeta((m) => ({ ...m, target: typeof v === "function" ? v(m.target) : v }));
```

This keeps the existing `setFxRate(rate)` and `setTarget(t)` call sites working unchanged, while persisting them into a single `meta` blob.

- [ ] **Step 4: Strip `currentPrice` from persisted holdings**

`currentPrice` is volatile (re-fetched on load) and storing stale prices is confusing. Modify `refreshAll` and `refreshOne` so persisted holdings always have `currentPrice: null` when freshly loaded, but UI sees the live value.

Two options:
- (Chosen) Always strip `currentPrice` on read by adding a normalization step in `useLocalStorage` initial value — but this complicates the hook. Simpler: accept that `currentPrice` will get persisted along with holdings (it's only one field per holding, and gets refreshed on load anyway).

Decision: accept that `currentPrice` persists. The auto-refresh on mount (`useEffect(refreshAll, [])`) overwrites it within seconds. No change required in this step.

- [ ] **Step 5: Run dev server, verify persistence**

```powershell
npm run dev
```

In the browser:
1. Delete a SAMPLE holding (Trash icon).
2. Refresh the page (F5).
3. Expected: The deleted holding stays deleted.
4. Open "목표 배분" modal, change values to `10/80/10`, save.
5. Refresh.
6. Expected: Target stays `10/80/10`.
7. Open DevTools → Application → Local Storage → `http://localhost:5173`. Confirm three keys exist (or just `meta` and `holdings` until Phase 2): `asset_dashboard_v1_meta`, `asset_dashboard_v1_holdings`.

Stop the server.

- [ ] **Step 6: Commit**

```powershell
git add src/AssetDashboard.jsx
git commit -m "feat: persist holdings, fxRate, and target to localStorage"
```

---

## Task 9: Build StorageButtons component (백업 / 불러오기 / 초기화)

**Files:**
- Create: `C:\dev\asset-dashboard\src\components\StorageButtons.jsx`
- Modify: `C:\dev\asset-dashboard\src\AssetDashboard.jsx`

- [ ] **Step 1: Create StorageButtons**

Create `C:\dev\asset-dashboard\src\components\StorageButtons.jsx`:

```jsx
import React, { useRef } from "react";
import { Download, Upload, Trash } from "lucide-react";
import { exportAll, importAll, resetAll } from "../lib/storage.js";

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export default function StorageButtons() {
  const fileRef = useRef(null);

  function handleExport() {
    const data = exportAll();
    downloadJSON(`asset-dashboard-backup-${todayStamp()}.json`, data);
  }

  function handleImportClick() {
    fileRef.current?.click();
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch {
        alert("JSON 파싱 실패. 백업 파일이 손상되었습니다.");
        return;
      }
      if (!window.confirm("현재 데이터가 모두 덮어쓰여집니다. 계속하시겠습니까?")) return;
      try {
        importAll(parsed);
        window.location.reload();
      } catch (err) {
        alert(`불러오기 실패: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  function handleReset() {
    if (!window.confirm("모든 데이터가 삭제됩니다. 계속하시겠습니까?")) return;
    resetAll();
    window.location.reload();
  }

  const iconBtn =
    "p-2 rounded-full border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition";

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFile}
      />
      <button onClick={handleExport} className={iconBtn} title="JSON 백업 다운로드">
        <Download size={14} />
      </button>
      <button onClick={handleImportClick} className={iconBtn} title="JSON 백업 불러오기">
        <Upload size={14} />
      </button>
      <button
        onClick={handleReset}
        className="p-2 rounded-full border border-slate-700 hover:border-rose-500 text-slate-400 hover:text-rose-400 transition"
        title="모든 데이터 초기화"
      >
        <Trash size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount StorageButtons in header**

In `C:\dev\asset-dashboard\src\AssetDashboard.jsx`, add to imports:

```jsx
import StorageButtons from "./components/StorageButtons.jsx";
```

Find the header buttons block:

```jsx
<div className="flex items-center gap-3">
  <button
    onClick={() => setShowTarget(true)}
    className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 hover:border-slate-500 text-sm transition"
  >
    <Target size={14} /> 목표 배분
  </button>
  <button
    onClick={refreshAll}
    ...
  >
```

Insert `<StorageButtons />` BEFORE the "목표 배분" button:

```jsx
<div className="flex items-center gap-3">
  <StorageButtons />
  <button
    onClick={() => setShowTarget(true)}
    ...
```

- [ ] **Step 3: Verify in dev**

```powershell
npm run dev
```

In the browser:
1. Header shows three small icon buttons (download, upload, trash) before "목표 배분".
2. Click download icon → browser downloads `asset-dashboard-backup-YYYYMMDD.json`. Open it in a text editor; verify it contains `schemaVersion: 1`, `keys.asset_dashboard_v1_meta`, `keys.asset_dashboard_v1_holdings`.
3. Modify some data (delete a holding, change target).
4. Click upload icon → select the downloaded file → confirm prompt → page reloads → original data restored.
5. Click trash icon → confirm prompt → page reloads → SAMPLE data appears (defaults).
6. Try uploading an invalid file (e.g., a `.txt` or a JSON missing `schemaVersion`): alert with helpful message.

Stop the server.

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "feat: add JSON backup, restore, and reset header buttons"
```

---

## Task 10: Phase 1 final verification and cleanup

**Files:**
- Delete: `C:\dev\asset_dashboard.jsx` (original is now superseded)
- Modify: `C:\dev\asset-dashboard\README.md` (or create) — minimal "how to run" notes

- [ ] **Step 1: Full regression pass**

Run `npm test`. Expected: all storage + useLocalStorage tests green.

Run `npm run dev`. Verify the entire app cycle once more:
- SAMPLE data loads
- Add a new holding via "+ 종목 추가" → persists across refresh
- Change target → persists
- Export → import roundtrip preserves state
- Reset → returns to SAMPLE defaults

Stop the server.

- [ ] **Step 2: Update README**

Replace `C:\dev\asset-dashboard\README.md` entirely with:

```markdown
# Asset Dashboard

자산관리 대시보드 — 국장 / 미장 / 코인 통합 포트폴리오 추적.

## 실행

```powershell
npm install
npm run dev
```

브라우저: `http://localhost:5173`

## 테스트

```powershell
npm test          # 1회 실행
npm run test:watch
```

## 빌드

```powershell
npm run build
npm run preview
```

## 데이터 저장

브라우저 `localStorage`에 `asset_dashboard_v1_*` 키로 저장. 헤더의 ↓ 버튼으로 JSON 백업, ↑ 버튼으로 복원, 🗑 버튼으로 전체 초기화.

## 스펙 / 계획

- 설계: `C:\dev\docs\superpowers\specs\2026-05-25-asset-dashboard-phase1to3-design.md`
- 진행: `C:\dev\docs\superpowers\plans\2026-05-25-asset-dashboard-phase0-1.md`
```

- [ ] **Step 3: Delete the original asset_dashboard.jsx**

Confirm with the user before deleting (this is the original source file). Once confirmed:

```powershell
Remove-Item C:\dev\asset_dashboard.jsx
```

If the user prefers to keep it as historical reference, skip this step and just note it in the README.

- [ ] **Step 4: Final commit**

```powershell
git add -A
git commit -m "docs: add README and finalize Phase 1"
```

- [ ] **Step 5: Hand off to user**

Report to the user:
- Phase 0 + Phase 1 complete.
- Vite project at `C:\dev\asset-dashboard\`.
- `localStorage` persistence + JSON backup / restore / reset working.
- All `npm test` green.
- Ready to plan Phase 2 (transactions / 평단 자동계산) when the user confirms.

---

## Self-Review Checklist (run before handing off)

This is a manual check before declaring the plan ready. Run through it once.

1. **Spec coverage**:
   - Spec §2 (Vite scaffolding) → Tasks 1–3
   - Spec §3.1 v1 schema → Task 6 (STORAGE_KEYS) + Task 8 (meta blob shape)
   - Spec §4.1 useLocalStorage hook → Task 7
   - Spec §4.2 백업 / 불러오기 / 초기화 buttons → Task 9
   - Spec §4.3 verification cases → Task 8 step 5, Task 9 step 3, Task 10 step 1
   - **Out**: Spec §5 (Phase 2) and §6 (Phase 3) — explicitly out of this plan.

2. **Placeholders**: None detected.

3. **Type / name consistency**:
   - `STORAGE_KEYS.{meta,holdings,transactions}` — defined Task 6, used Task 6/8.
   - `exportAll` / `importAll` / `resetAll` / `validateBackup` — defined Task 6, used Task 9.
   - `useLocalStorage(key, initialValue)` → `[value, set]` — defined Task 7, used Task 8.
   - `meta.schemaVersion: 1`, `meta.fxRate`, `meta.target` — consistent across spec §3.1 v1 and Task 8.
