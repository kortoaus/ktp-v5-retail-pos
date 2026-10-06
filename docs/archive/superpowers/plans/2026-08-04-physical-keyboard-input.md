# Physical Keyboard Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While an `OnScreenKeyboard` instance is visible, translate physical keydown events into the on-screen key tokens (including dubeolsik jamo) and feed them through the existing `handleKey` path.

**Architecture:** A pure resolver module (`physical-key-map.ts`) maps `(e.code, shiftKey, mode)` → token; a thin hook (`usePhysicalKeyboard.ts`) owns a capture-phase `window` keydown listener gated on the instance's visibility (`offsetParent !== null`) and stops propagation so the bubble-phase barcode-scanner hook never sees handled keys. `OnScreenKeyboard/index.tsx` wires the hook to its existing `handleKey`.

**Tech Stack:** React 19 renderer (electron-vite), TypeScript strict, `node:test` via `node --experimental-strip-types` (repo pattern: `retail_pos_app/scripts/tests/*.test.ts` with dynamic `await import("../../src/….ts")`).

**Spec:** `docs/superpowers/specs/2026-08-04-physical-keyboard-input-design.md`

## Global Constraints

- Renderer code: no `electron`/Node imports, no `as any` / `@ts-ignore` (strict TS).
- All work in `retail_pos_app/`; the server is untouched.
- Typecheck gate: `cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json`.
- Do not modify `useBarcodeScanner.ts`, `KeyboardKey.tsx`, `useHangulComposer.ts`, or any screen.
- Physical Shift is per-keystroke (`e.shiftKey`); never read/write the on-screen sticky `shifted` state.
- Physical Escape is deliberately unmapped.

---

### Task 1: Pure resolver `physical-key-map.ts` (TDD)

**Files:**
- Create: `retail_pos_app/src/renderer/src/components/OnScreenKeyboard/physical-key-map.ts`
- Test: `retail_pos_app/scripts/tests/physical-key-map.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 2):
  - `type PhysicalMode = "korean" | "english" | "numpad"`
  - `resolvePhysicalKey(code: string, shiftKey: boolean, mode: PhysicalMode): string | null`
  - `isLangToggle(code: string, key: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `retail_pos_app/scripts/tests/physical-key-map.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

const { resolvePhysicalKey, isLangToggle } = await import(
  "../../src/renderer/src/components/OnScreenKeyboard/physical-key-map.ts"
);

test("english letters, shift = uppercase", () => {
  assert.equal(resolvePhysicalKey("KeyA", false, "english"), "a");
  assert.equal(resolvePhysicalKey("KeyA", true, "english"), "A");
  assert.equal(resolvePhysicalKey("KeyP", false, "english"), "p");
});

test("korean dubeolsik jamo by QWERTY position", () => {
  assert.equal(resolvePhysicalKey("KeyQ", false, "korean"), "ㅂ");
  assert.equal(resolvePhysicalKey("KeyR", false, "korean"), "ㄱ");
  assert.equal(resolvePhysicalKey("KeyK", false, "korean"), "ㅏ");
  assert.equal(resolvePhysicalKey("KeyM", false, "korean"), "ㅡ");
});

test("korean shift differentiates only the five doubles and ㅒㅖ", () => {
  assert.equal(resolvePhysicalKey("KeyQ", true, "korean"), "ㅃ");
  assert.equal(resolvePhysicalKey("KeyW", true, "korean"), "ㅉ");
  assert.equal(resolvePhysicalKey("KeyE", true, "korean"), "ㄸ");
  assert.equal(resolvePhysicalKey("KeyR", true, "korean"), "ㄲ");
  assert.equal(resolvePhysicalKey("KeyT", true, "korean"), "ㅆ");
  assert.equal(resolvePhysicalKey("KeyO", true, "korean"), "ㅒ");
  assert.equal(resolvePhysicalKey("KeyP", true, "korean"), "ㅖ");
  // shift on a non-double letter falls back to the base jamo
  assert.equal(resolvePhysicalKey("KeyA", true, "korean"), "ㅁ");
  assert.equal(resolvePhysicalKey("KeyK", true, "korean"), "ㅏ");
});

test("digit row and shift symbols in text modes", () => {
  assert.equal(resolvePhysicalKey("Digit1", false, "english"), "1");
  assert.equal(resolvePhysicalKey("Digit1", true, "english"), "!");
  assert.equal(resolvePhysicalKey("Digit0", true, "korean"), ")");
  assert.equal(resolvePhysicalKey("Digit5", false, "korean"), "5");
});

test("punctuation with shift variants in text modes", () => {
  assert.equal(resolvePhysicalKey("Minus", false, "english"), "-");
  assert.equal(resolvePhysicalKey("Minus", true, "english"), "_");
  assert.equal(resolvePhysicalKey("Period", false, "korean"), ".");
  assert.equal(resolvePhysicalKey("Slash", true, "english"), "?");
  assert.equal(resolvePhysicalKey("Quote", true, "english"), '"');
  assert.equal(resolvePhysicalKey("Backquote", false, "english"), "`");
});

test("numpad hardware keys in text modes", () => {
  assert.equal(resolvePhysicalKey("Numpad7", false, "english"), "7");
  assert.equal(resolvePhysicalKey("NumpadDecimal", false, "korean"), ".");
  assert.equal(resolvePhysicalKey("NumpadAdd", false, "english"), "+");
});

test("space and control tokens", () => {
  assert.equal(resolvePhysicalKey("Space", false, "english"), " ");
  assert.equal(resolvePhysicalKey("Space", false, "korean"), " ");
  assert.equal(resolvePhysicalKey("Enter", false, "korean"), "ENTER");
  assert.equal(resolvePhysicalKey("NumpadEnter", false, "numpad"), "ENTER");
  assert.equal(resolvePhysicalKey("Backspace", true, "english"), "BACKSPACE");
});

test("numpad mode allows only digits, minus, period, enter, backspace", () => {
  assert.equal(resolvePhysicalKey("Digit3", false, "numpad"), "3");
  assert.equal(resolvePhysicalKey("Numpad3", false, "numpad"), "3");
  assert.equal(resolvePhysicalKey("Minus", false, "numpad"), "-");
  assert.equal(resolvePhysicalKey("NumpadSubtract", false, "numpad"), "-");
  assert.equal(resolvePhysicalKey("Period", false, "numpad"), ".");
  assert.equal(resolvePhysicalKey("NumpadDecimal", false, "numpad"), ".");
  assert.equal(resolvePhysicalKey("KeyA", false, "numpad"), null);
  assert.equal(resolvePhysicalKey("Space", false, "numpad"), null);
  assert.equal(resolvePhysicalKey("Digit1", true, "numpad"), null);
  assert.equal(resolvePhysicalKey("NumpadAdd", false, "numpad"), null);
  assert.equal(resolvePhysicalKey("Slash", false, "numpad"), null);
});

test("unmapped codes return null", () => {
  assert.equal(resolvePhysicalKey("Escape", false, "english"), null);
  assert.equal(resolvePhysicalKey("Tab", false, "english"), null);
  assert.equal(resolvePhysicalKey("F5", false, "korean"), null);
  assert.equal(resolvePhysicalKey("ArrowLeft", false, "english"), null);
  assert.equal(resolvePhysicalKey("CapsLock", false, "english"), null);
  assert.equal(resolvePhysicalKey("ShiftLeft", false, "english"), null);
});

test("isLangToggle detects Lang1, AltRight, HangulMode", () => {
  assert.equal(isLangToggle("Lang1", ""), true);
  assert.equal(isLangToggle("AltRight", "Alt"), true);
  assert.equal(isLangToggle("KeyA", "HangulMode"), true);
  assert.equal(isLangToggle("KeyA", "a"), false);
  assert.equal(isLangToggle("AltLeft", "Alt"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd retail_pos_app && node --experimental-strip-types scripts/tests/physical-key-map.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `physical-key-map.ts`.

- [ ] **Step 3: Write the implementation**

Create `retail_pos_app/src/renderer/src/components/OnScreenKeyboard/physical-key-map.ts`:

```ts
export type PhysicalMode = "korean" | "english" | "numpad";

// QWERTY position → dubeolsik jamo (same arrangement as layouts.ts KOREAN)
const KOREAN_BASE: Record<string, string> = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ",
  y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ",
  h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ",
  b: "ㅠ", n: "ㅜ", m: "ㅡ",
};

const KOREAN_SHIFTED: Record<string, string> = {
  q: "ㅃ", w: "ㅉ", e: "ㄸ", r: "ㄲ", t: "ㅆ", o: "ㅒ", p: "ㅖ",
};

const DIGIT_SHIFT: Record<string, string> = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%",
  "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
};

// code → [base, shifted]
const PUNCTUATION: Record<string, [string, string]> = {
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Backquote: ["`", "~"],
};

const NUMPAD_CHARS: Record<string, string> = {
  NumpadDecimal: ".",
  NumpadSubtract: "-",
  NumpadAdd: "+",
  NumpadMultiply: "*",
  NumpadDivide: "/",
};

export function isLangToggle(code: string, key: string): boolean {
  return code === "Lang1" || code === "AltRight" || key === "HangulMode";
}

export function resolvePhysicalKey(
  code: string,
  shiftKey: boolean,
  mode: PhysicalMode,
): string | null {
  if (code === "Enter" || code === "NumpadEnter") return "ENTER";
  if (code === "Backspace") return "BACKSPACE";

  const rowDigit = /^Digit(\d)$/.exec(code)?.[1] ?? null;
  const padDigit = /^Numpad(\d)$/.exec(code)?.[1] ?? null;

  if (mode === "numpad") {
    if (padDigit !== null) return padDigit;
    if (code === "NumpadSubtract") return "-";
    if (code === "NumpadDecimal") return ".";
    if (shiftKey) return null;
    if (rowDigit !== null) return rowDigit;
    if (code === "Minus") return "-";
    if (code === "Period") return ".";
    return null;
  }

  if (code === "Space") return " ";
  if (padDigit !== null) return padDigit;
  if (rowDigit !== null) return shiftKey ? DIGIT_SHIFT[rowDigit] : rowDigit;

  const numpadChar = NUMPAD_CHARS[code];
  if (numpadChar !== undefined) return numpadChar;

  const punctuation = PUNCTUATION[code];
  if (punctuation !== undefined) return shiftKey ? punctuation[1] : punctuation[0];

  const letter = /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? null;
  if (letter === null) return null;
  if (mode === "english") return shiftKey ? letter.toUpperCase() : letter;
  return (shiftKey ? KOREAN_SHIFTED[letter] : undefined) ?? KOREAN_BASE[letter] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd retail_pos_app && node --experimental-strip-types scripts/tests/physical-key-map.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add retail_pos_app/src/renderer/src/components/OnScreenKeyboard/physical-key-map.ts retail_pos_app/scripts/tests/physical-key-map.test.ts
git commit -m "feat(app): physical key → on-screen keyboard token resolver"
```

---

### Task 2: `usePhysicalKeyboard` hook + wiring into `OnScreenKeyboard`

**Files:**
- Create: `retail_pos_app/src/renderer/src/components/OnScreenKeyboard/usePhysicalKeyboard.ts`
- Modify: `retail_pos_app/src/renderer/src/components/OnScreenKeyboard/index.tsx`

**Interfaces:**
- Consumes (Task 1): `resolvePhysicalKey(code, shiftKey, mode)`, `isLangToggle(code, key)`, `PhysicalMode`.
- Consumes (existing): `handleKey(keyValue: string): void` in `index.tsx` — already accepts every token the resolver emits (`"LANG_EN"`, `"LANG_KR"`, `"ENTER"`, `"BACKSPACE"`, jamo, literal chars).
- Produces: `usePhysicalKeyboard(opts: { rootRef: React.RefObject<HTMLDivElement | null>; lang: "korean" | "english"; showNumpad: boolean; onKey: (keyValue: string) => void }): void`

- [ ] **Step 1: Write the hook**

Create `retail_pos_app/src/renderer/src/components/OnScreenKeyboard/usePhysicalKeyboard.ts`:

```ts
import { useEffect, useRef, type RefObject } from "react";
import {
  isLangToggle,
  resolvePhysicalKey,
  type PhysicalMode,
} from "./physical-key-map";

interface UsePhysicalKeyboardOptions {
  rootRef: RefObject<HTMLDivElement | null>;
  lang: "korean" | "english";
  showNumpad: boolean;
  onKey: (keyValue: string) => void;
}

/**
 * Feeds physical keydown events into the on-screen keyboard while its root
 * element is visible. Capture-phase + stopPropagation keeps handled keys away
 * from the bubble-phase barcode-scanner listener; hidden instances (CSS
 * `hidden` on multi-keyboard screens) bail via the offsetParent check.
 */
export function usePhysicalKeyboard({
  rootRef,
  lang,
  showNumpad,
  onKey,
}: UsePhysicalKeyboardOptions): void {
  const stateRef = useRef({ lang, showNumpad, onKey });
  stateRef.current = { lang, showNumpad, onKey };

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const el = rootRef.current;
      if (!el || el.offsetParent === null) return;
      if (e.ctrlKey || e.metaKey || (e.altKey && e.code !== "AltRight")) return;

      const { lang, showNumpad, onKey } = stateRef.current;

      const consume = (): void => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      if (isLangToggle(e.code, e.key)) {
        if (!showNumpad) {
          consume();
          onKey(lang === "korean" ? "LANG_EN" : "LANG_KR");
        }
        return;
      }

      const mode: PhysicalMode = showNumpad ? "numpad" : lang;
      const token = resolvePhysicalKey(e.code, e.shiftKey, mode);
      if (token === null) return;
      consume();
      onKey(token);
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [rootRef]);
}
```

- [ ] **Step 2: Wire into `index.tsx`**

Modify `retail_pos_app/src/renderer/src/components/OnScreenKeyboard/index.tsx`:

Add imports (`useRef` joins the existing react import):

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import { usePhysicalKeyboard } from "./usePhysicalKeyboard";
```

Inside the component, after the `handleKey` definition, add:

```ts
const rootRef = useRef<HTMLDivElement | null>(null);
usePhysicalKeyboard({ rootRef, lang, showNumpad, onKey: handleKey });
```

Attach the ref to the root div:

```tsx
<div
  ref={rootRef}
  className={`w-full bg-gray-100 p-2 rounded-xl select-none ${className}`}
>
```

- [ ] **Step 3: Typecheck**

Run: `cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json`
Expected: exit 0, no errors.

- [ ] **Step 4: Re-run Task 1 tests (regression)**

Run: `cd retail_pos_app && node --experimental-strip-types scripts/tests/physical-key-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add retail_pos_app/src/renderer/src/components/OnScreenKeyboard/usePhysicalKeyboard.ts retail_pos_app/src/renderer/src/components/OnScreenKeyboard/index.tsx
git commit -m "feat(app): physical keyboard drives the visible on-screen keyboard"
```

---

### Task 3: Manual regression items + doc sync + full verification

**Files:**
- Modify: `TEST_CHECKLIST.md` (deliberate doc edit — append a section)
- Modify: `retail_pos_app/CLAUDE.md` (record the new key-event boundary)

**Interfaces:**
- Consumes: the shipped behavior of Tasks 1–2. Produces: nothing for later tasks.

- [ ] **Step 1: Append a section to `TEST_CHECKLIST.md`**

Match the file's existing Korean checkbox style (inspect it first; adapt numbering/format to fit). Content to add:

```markdown
## 피지컬 키보드 입력 (온스크린 키보드)

- [ ] 아이템 검색 모달에서 물리 키보드 영문 타이핑 → 필드에 즉시 입력됨 (Shift = 대문자)
- [ ] 한/영 전환: 한/영 키(또는 오른쪽 Alt) → 레이아웃 전환, 두벌식 한글 조합 정상 (예: "rkskek" → "가나다")
- [ ] Shift+자음 → 쌍자음 (ㅃㅉㄸㄲㅆ), Backspace → 자모 단위 삭제
- [ ] 물리 Enter → 온스크린 Enter와 동일 동작 (검색 실행 / 오버레이 닫힘)
- [ ] 넘패드 레이아웃(전화번호/OTP/금액)에서 문자 키 무시, 숫자·`-`·`.`만 입력됨
- [ ] Cash IO 화면에서 amount ↔ note 필드 전환 시 물리 입력이 보이는 키보드에만 들어감
- [ ] 키보드가 안 보이는 상태의 SaleScreen에서 바코드 스캔 정상 동작 (스캐너 회귀 없음)
- [ ] 키보드가 떠 있는 동안 Ctrl/Alt 조합키(개발자도구 등)가 막히지 않음
```

- [ ] **Step 2: Record the new boundary in `retail_pos_app/CLAUDE.md`**

In the "Scales & Scanner" section, after the `useBarcodeScanner` paragraph, add:

```markdown
`components/OnScreenKeyboard/usePhysicalKeyboard.ts` is the second key-event boundary: while an
`OnScreenKeyboard` instance is visible (`offsetParent` check — hidden instances on multi-keyboard
screens bail), it consumes mapped keydowns in the **capture phase** with `stopPropagation`, so the
scanner hook sees nothing while a keyboard is on screen. Mapping lives in the pure
`physical-key-map.ts` (dubeolsik by `e.code` position, numpad-mode restriction, `Lang1`/`AltRight`/
`HangulMode` = 한/영). A barcode scanned while a keyboard is visible types into the field —
accepted trade-off, see the 2026-08-04 design spec.
```

- [ ] **Step 3: Full verification**

```bash
cd retail_pos_app && npx tsc --noEmit -p tsconfig.web.json && npm run build
node --experimental-strip-types scripts/tests/physical-key-map.test.ts
```

Expected: typecheck exit 0, electron-vite build succeeds, tests pass.

- [ ] **Step 4: Commit**

```bash
git add TEST_CHECKLIST.md retail_pos_app/CLAUDE.md
git commit -m "docs: physical keyboard regression checklist + key-event boundary note"
```
