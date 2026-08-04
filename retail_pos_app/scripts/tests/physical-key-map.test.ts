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

test("review pass: extra edges", () => {
  assert.equal(resolvePhysicalKey("NumpadEnter", false, "english"), "ENTER");
  assert.equal(resolvePhysicalKey("Digit0", false, "english"), "0");
  assert.equal(resolvePhysicalKey("Numpad0", false, "numpad"), "0");
  assert.equal(resolvePhysicalKey("Backslash", false, "english"), "\\");
  assert.equal(resolvePhysicalKey("Backslash", true, "english"), "|");
  assert.equal(resolvePhysicalKey("Space", true, "english"), " ");
  assert.equal(resolvePhysicalKey("Space", true, "korean"), " ");
});
