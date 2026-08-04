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
