export type KeyDef = {
  label: string;
  value: string;
  width?: number;
  variant?: "default" | "action" | "space";
};

export type LayoutRow = KeyDef[];
export type Layout = LayoutRow[];

const key = (label: string, value?: string, width?: number, variant?: KeyDef["variant"]): KeyDef => ({
  label,
  value: value ?? label,
  ...(width != null && { width }),
  ...(variant != null && { variant }),
});

const action = (label: string, value: string, width?: number): KeyDef =>
  key(label, value, width, "action");

export const KOREAN: Layout = [
  [key("ㅂ"), key("ㅈ"), key("ㄷ"), key("ㄱ"), key("ㅅ"), key("ㅛ"), key("ㅕ"), key("ㅑ"), key("ㅐ"), key("ㅔ")],
  [key("ㅁ"), key("ㄴ"), key("ㅇ"), key("ㄹ"), key("ㅎ"), key("ㅗ"), key("ㅓ"), key("ㅏ"), key("ㅣ")],
  [action("⇧", "SHIFT", 1.5), key("ㅋ"), key("ㅌ"), key("ㅊ"), key("ㅍ"), key("ㅠ"), key("ㅜ"), key("ㅡ"), action("⌫", "BACKSPACE", 1.5)],
  [action("123", "NUMPAD", 1.5), action("EN", "LANG_EN", 1.5), key(" ", " ", 4, "space"), action("Enter", "ENTER", 2)],
];

export const KOREAN_SHIFT: Layout = [
  [key("ㅃ"), key("ㅉ"), key("ㄸ"), key("ㄲ"), key("ㅆ"), key("ㅛ"), key("ㅕ"), key("ㅑ"), key("ㅒ"), key("ㅖ")],
  [key("ㅁ"), key("ㄴ"), key("ㅇ"), key("ㄹ"), key("ㅎ"), key("ㅗ"), key("ㅓ"), key("ㅏ"), key("ㅣ")],
  [action("⇧", "SHIFT", 1.5), key("ㅋ"), key("ㅌ"), key("ㅊ"), key("ㅍ"), key("ㅠ"), key("ㅜ"), key("ㅡ"), action("⌫", "BACKSPACE", 1.5)],
  [action("123", "NUMPAD", 1.5), action("EN", "LANG_EN", 1.5), key(" ", " ", 4, "space"), action("Enter", "ENTER", 2)],
];

export const ENGLISH: Layout = [
  [key("q"), key("w"), key("e"), key("r"), key("t"), key("y"), key("u"), key("i"), key("o"), key("p")],
  [key("a"), key("s"), key("d"), key("f"), key("g"), key("h"), key("j"), key("k"), key("l")],
  [action("⇧", "SHIFT", 1.5), key("z"), key("x"), key("c"), key("v"), key("b"), key("n"), key("m"), action("⌫", "BACKSPACE", 1.5)],
  [action("123", "NUMPAD", 1.5), action("한", "LANG_KR", 1.5), key(" ", " ", 4, "space"), action("Enter", "ENTER", 2)],
];

export const ENGLISH_SHIFT: Layout = [
  [key("Q"), key("W"), key("E"), key("R"), key("T"), key("Y"), key("U"), key("I"), key("O"), key("P")],
  [key("A"), key("S"), key("D"), key("F"), key("G"), key("H"), key("J"), key("K"), key("L")],
  [action("⇧", "SHIFT", 1.5), key("Z"), key("X"), key("C"), key("V"), key("B"), key("N"), key("M"), action("⌫", "BACKSPACE", 1.5)],
  [action("123", "NUMPAD", 1.5), action("한", "LANG_KR", 1.5), key(" ", " ", 4, "space"), action("Enter", "ENTER", 2)],
];

export const NUMPAD: Layout = [
  [key("1"), key("2"), key("3")],
  [key("4"), key("5"), key("6")],
  [key("7"), key("8"), key("9")],
  [key("."), key("0"), action("⌫", "BACKSPACE")],
  [action("ABC", "LANG_PREV", 2), action("Enter", "ENTER", 1)],
];
