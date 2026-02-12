# Virtual Keyboard Implementation Plan

File: `src/renderer/src/components/VirtualKeyboard/`
Dependencies: `es-hangul` (zero-dep Hangul utility by Toss)

---

## 1. Overview

OS-free on-screen keyboard for POS touchscreen terminals. Supports Korean (Hangul), English, and numpad input. Built as an in-repo component, may be extracted to a separate package later.

**Priority**: Performance and stability over features.

---

## 2. Component Interface

```typescript
interface VirtualKeyboardProps {
  value: string;
  onChange: (newValue: string) => void;
  onEnter?: () => void;
  onClose?: () => void;
  layout?: "korean" | "english" | "numpad";
  className?: string;
}
```

Controlled component. Parent owns `value` + `onChange`. Keyboard does not manage input state internally.

---

## 3. Layouts

Three layouts, switchable via a toggle key on the keyboard itself.

### 3.1 Korean (두벌식 — Standard Dubeolsik)

```
ㅂ ㅈ ㄷ ㄱ ㅅ ㅛ ㅕ ㅑ ㅐ ㅔ
ㅁ ㄴ ㅇ ㄹ ㅎ ㅗ ㅓ ㅏ ㅣ
⇧  ㅋ ㅌ ㅊ ㅍ ㅠ ㅜ ㅡ  ⌫
[123] [EN] [SPACE] [Enter]
```

**Shift layer** (for double consonants / compound vowels):

```
ㅃ ㅉ ㄸ ㄲ ㅆ ㅛ ㅕ ㅑ ㅒ ㅖ
ㅁ ㄴ ㅇ ㄹ ㅎ ㅗ ㅓ ㅏ ㅣ
⇧  ㅋ ㅌ ㅊ ㅍ ㅠ ㅜ ㅡ  ⌫
[123] [EN] [SPACE] [Enter]
```

### 3.2 English (QWERTY)

```
q w e r t y u i o p
a s d f g h j k l
⇧  z x c v b n m  ⌫
[123] [KR] [SPACE] [Enter]
```

Shift toggles uppercase. Single-tap shift = one uppercase letter then auto-revert. Double-tap = caps lock.

### 3.3 Numpad

```
1 2 3
4 5 6
7 8 9
. 0 ⌫
[ABC] [Enter]
```

---

## 4. Hangul Composition

Uses `es-hangul` for jamo → syllable assembly.

### How it works:

1. User taps jamo keys (e.g. ㅎ, ㅏ, ㄴ).
2. Maintain a `jamoBuffer: string[]` of uncommitted jamo.
3. On each keystroke, call `assemble(jamoBuffer)` from es-hangul.
4. The last character(s) from `assemble()` output are the "composing" text.
5. Call `onChange(committedText + composingText)`.

### Commit triggers:

Jamo buffer commits (flushes to `committedText`) when:

- User taps a non-jamo key (space, enter, number, punctuation)
- User switches layout
- User taps backspace when buffer is empty
- A syllable is complete and the next jamo cannot combine

### Backspace behavior:

- If `jamoBuffer` is not empty: pop last jamo, re-assemble, update composing text.
- If `jamoBuffer` is empty: delete last character from `value`.

---

## 5. Component Architecture

```
VirtualKeyboard/
  index.tsx              ← Main component, layout switching, key dispatch
  KeyboardKey.tsx        ← Individual key button (memoized)
  layouts.ts             ← Layout definitions (korean, koreanShift, english, englishShift, numpad)
  useHangulComposer.ts   ← Hook: jamo buffer management + es-hangul assemble
  styles.css             ← Keyboard-specific styles (not global)
```

### Performance considerations:

- `KeyboardKey` must be `React.memo`'d — prevent re-render of 30+ keys on every keystroke.
- Layout arrays are static constants (defined outside component).
- `useHangulComposer` manages buffer internally, only calls `onChange` when output changes.
- No state in the keyboard that isn't necessary. Minimal re-renders.

---

## 6. Key Component

```typescript
interface KeyProps {
  label: string;
  value: string; // actual character to emit (may differ from label)
  width?: number; // flex multiplier (default 1)
  variant?: "default" | "action" | "space";
  onPress: (value: string) => void;
}
```

- Touch-optimized: large hit targets, no hover states.
- `onPress` fires on `pointerdown` (not click) for responsiveness.
- Visual feedback: brief active state on press.

---

## 7. useHangulComposer Hook

```typescript
interface HangulComposer {
  handleJamo: (jamo: string) => void;
  handleBackspace: () => void;
  flush: () => void; // commit buffer, return to clean state
  composingText: string; // current uncommitted syllable(s)
}

function useHangulComposer(
  value: string,
  onChange: (newValue: string) => void,
): HangulComposer;
```

- The hook owns `jamoBuffer` (internal state, not exposed).
- `handleJamo(jamo)`: append to buffer, assemble, call onChange with `committed + assembled`.
- `handleBackspace()`: pop from buffer if non-empty, otherwise trim `value`.
- `flush()`: commit current composing text, clear buffer.
- `composingText`: derived from `assemble(jamoBuffer)`.

---

## 8. Integration Pattern

```tsx
const [searchText, setSearchText] = useState('')

<input value={searchText} readOnly />
<VirtualKeyboard
  value={searchText}
  onChange={setSearchText}
  onEnter={() => doSearch(searchText)}
/>
```

The `<input>` is read-only (prevents OS keyboard from appearing). All input flows through the virtual keyboard.

---

## 9. Styling Approach

- Tailwind for layout (flex, grid, padding, sizing).
- Fixed or absolute positioning — keyboard sits at bottom of its container.
- POS-specific: large keys (min 48px height), high contrast, clear font.
- Dark/light agnostic — use neutral grays that work on any background.

---

## 10. Scope Boundaries — NOT in scope for v1

- Autocomplete / suggestions
- Swipe typing
- Emoji
- Custom key mapping / remapping
- Sound feedback
- Cursor positioning within text (always append/delete from end)
- Auto-show on focus (manual trigger only for v1)
- Animation (no transitions for performance)

---

## 11. Dependencies

| Package     | Purpose                     | Size              |
| ----------- | --------------------------- | ----------------- |
| `es-hangul` | Hangul assemble/disassemble | 141 KB, zero deps |

No other dependencies. No virtual keyboard framework.

---

## 12. Resolved Questions

- **Shift auto-revert in Korean?** No. No hidden/implicit actions. Shift is explicit toggle only.
- **Decimal/price numpad?** Out of scope. This keyboard is for search keyword input only. Price numpad will be a separate component.
- **Physical keyboard pass-through?** No. Keep it simple — one input method at a time, no confusion.
