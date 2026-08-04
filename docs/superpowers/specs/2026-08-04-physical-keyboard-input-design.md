# Physical Keyboard Input for the On-Screen Keyboard — Design

Date: 2026-08-04
Status: approved (direction confirmed by owner; details delegated)

## Problem

The till has no real `<input>` elements anywhere. All text entry goes through the tap-only
`OnScreenKeyboard` component (directly embedded on 8 screens, or via the `KeyboardInputText`
full-screen overlay). A physical keyboard plugged into the terminal is therefore useless for
typing — its events go nowhere, except into `useBarcodeScanner`'s HID-wedge heuristics.

## Goal

While an `OnScreenKeyboard` instance is **visible**, physical keydown events are translated into
the same key tokens the on-screen keys produce and fed through the existing `handleKey` path —
including dubeolsik Korean composition via `useHangulComposer` — without touching the OS IME.

## Non-Goals

- No global focus system. When no on-screen keyboard is visible, physical typing continues to do
  nothing (and the barcode scanner hook keeps sole ownership of key events).
- No scanner-burst detection in v1. A barcode scanned while a keyboard is visible types its
  characters into the field; this is the accepted consequence of "typing owns the keys".
- No change to the customer display, main process, or server.

## Decision: visibility-scoped, not global

An earlier alternative — a global hook with its own notion of "focused field" — was rejected:
there is no focus concept in this renderer, so the modal/embedded keyboard being visible is the
only meaningful "this field is being edited" signal. Ownership rule:

> **The visible `OnScreenKeyboard` instance owns the physical keyboard.**

Several screens (CashIOForm, UserForm, StoreSettingScreen) mount multiple keyboards
simultaneously and hide all but one with CSS `hidden`. Visibility is therefore checked per event
via `offsetParent !== null` on the instance's root element; hidden instances ignore the event.

## Architecture

Two new files in `retail_pos_app/src/renderer/src/components/OnScreenKeyboard/`, one edit:

### 1. `physical-key-map.ts` — pure resolver (fully unit-testable)

```ts
type PhysicalMode = "korean" | "english" | "numpad";
resolvePhysicalKey(code: string, shiftKey: boolean, mode: PhysicalMode): string | null
```

Returns a token `handleKey` already understands — a literal character/jamo to insert, `" "`,
`"BACKSPACE"`, `"ENTER"` — or `null` for "not ours, let it pass".

Mapping rules:

| Input | korean | english | numpad |
|---|---|---|---|
| `KeyA`–`KeyZ` | dubeolsik jamo by QWERTY position; Shift only differentiates ㅃㅉㄸㄲㅆ / ㅒㅖ | letter; Shift → uppercase | `null` |
| `Digit0`–`Digit9` | digit; Shift → US symbol (`!@#$%^&*()`) | same | digit (Shift → `null`) |
| Punctuation (`Minus Equal BracketLeft/Right Semicolon Quote Comma Period Slash Backquote`) | US char, Shift variant | same | only `Minus` → `-`, `Period` → `.`, else `null` |
| `NumpadN`, `NumpadDecimal/Subtract` etc. | digit / char | same | digit / char |
| `Space` | `" "` | `" "` | `null` |
| `Enter`, `NumpadEnter` | `"ENTER"` | `"ENTER"` | `"ENTER"` |
| `Backspace` | `"BACKSPACE"` | `"BACKSPACE"` | `"BACKSPACE"` |
| anything else | `null` | `null` | `null` |

Language toggle is resolved separately (it needs current lang, not mode):
`isLangToggle(code, key)` → true for `code ∈ {Lang1, AltRight}` or `key === "HangulMode"`.
The caller emits `"LANG_EN"` or `"LANG_KR"` (the opposite of current lang). Toggle is honored in
korean/english modes only, not numpad.

Modifier policy, applied by the hook before the resolver: events with `ctrlKey || metaKey ||
(altKey && code !== "AltRight")` are ignored (no preventDefault) so app/devtools shortcuts pass.
`e.repeat` is allowed (key auto-repeat works, notably Backspace).

### 2. `usePhysicalKeyboard.ts` — thin DOM hook

```ts
usePhysicalKeyboard(opts: {
  rootRef: RefObject<HTMLElement>;
  lang: "korean" | "english";
  showNumpad: boolean;
  onKey: (token: string) => void;   // OnScreenKeyboard's handleKey
})
```

- Registers one `window.addEventListener("keydown", handler, { capture: true })` per mounted
  instance; removed on unmount.
- Handler sequence: (1) bail if `rootRef.current?.offsetParent == null` (hidden/unmounted);
  (2) bail on modifier policy; (3) lang-toggle check → `onKey("LANG_EN" | "LANG_KR")`;
  (4) `resolvePhysicalKey(code, shiftKey, mode)` where `mode = showNumpad ? "numpad" : lang`;
  (5) on a non-null token: `preventDefault()`, `stopPropagation()`,
  `stopImmediatePropagation()`, `onKey(token)`. On `null`: do nothing — the event propagates
  normally (scanner heuristics will discard slow human keystrokes as they do today).
- `stopPropagation` in the capture phase on `window` halts propagation before the bubble phase,
  which is where `useBarcodeScanner` listens — so handled keys never reach the scanner.
  `stopImmediatePropagation` additionally guards the (theoretically impossible) case of two
  visible instances.

Physical Shift is per-keystroke (`e.shiftKey`); it neither reads nor writes the on-screen sticky
`shifted` state.

### 3. `index.tsx` edit

Attach a root `ref`, call the hook. Physical tokens flow through the existing `handleKey`, so
composition, `flush()` on mode switches, and `onEnter` behave identically to taps. Jamo tokens
reach the composer only when `lang === "korean" && !showNumpad` — the numpad-mode resolver
already returns no jamo, so the paths agree.

## Behavior changes to be aware of

1. **Scan-while-typing.** Previously, scanning with a search modal open dispatched to the screen
   behind it (e.g. SearchItemModal open → item added to the cart behind the modal). Now, while a
   keyboard is visible, the burst is typed into the field (numpad modes strip non-digits via
   their existing `onChange` sanitizers). Accepted; revisit with burst detection only if stores
   complain.
2. Physical Enter submits whatever `onEnter` does on that screen (search, OTP verify, close
   overlay) — same as tapping the on-screen Enter.

## Testing

- TDD `physical-key-map.ts` with `node:test`, colocated as
  `physical-key-map.test.ts`, run via `node --experimental-strip-types` (repo pattern).
  Cover: letters/case, jamo/shift-jamo, digits/symbols, punctuation, numpad restrictions,
  Enter/Backspace/Space, toggle detection, unmapped → null.
- The hook and component wiring have no DOM test runner in this repo: gate with
  `npx tsc --noEmit -p tsconfig.web.json` and add a manual item to `TEST_CHECKLIST.md`
  (deliberate doc edit): physical typing in EN/KR/numpad, 한/영 toggle, hidden-keyboard screens
  (CashIOForm field switch), scanner still works on SaleScreen with no keyboard visible.

## Out of scope, recorded

`OnScreenKeyboard`'s `onClose` prop is accepted and unused (`_onClose`) — physical Escape is
deliberately not mapped (risk of accidental submits/closes on embedded screens).
