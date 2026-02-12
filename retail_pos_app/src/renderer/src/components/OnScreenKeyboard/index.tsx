import { useCallback, useMemo, useState } from "react";
import { KeyboardKey } from "./KeyboardKey";
import { useHangulComposer } from "./useHangulComposer";
import {
  KOREAN,
  KOREAN_SHIFT,
  ENGLISH,
  ENGLISH_SHIFT,
  NUMPAD,
  type Layout,
} from "./layouts";

type Lang = "korean" | "english";

interface OnScreenKeyboardProps {
  value: string;
  onChange: (newValue: string) => void;
  onEnter?: () => void;
  onClose?: () => void;
  initialLayout?: Lang | "numpad";
  className?: string;
}

const JAMO = new Set([
  "ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ",
  "ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ",
  "ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅛ",
  "ㅜ","ㅠ","ㅡ","ㅣ",
]);

export default function OnScreenKeyboard({
  value,
  onChange,
  onEnter,
  onClose: _onClose,
  initialLayout = "korean",
  className = "",
}: OnScreenKeyboardProps) {
  const [lang, setLang] = useState<Lang>(
    initialLayout === "numpad" ? "korean" : initialLayout,
  );
  const [showNumpad, setShowNumpad] = useState(initialLayout === "numpad");
  const [shifted, setShifted] = useState(false);

  const composer = useHangulComposer(value, onChange);

  const layout: Layout = useMemo(() => {
    if (showNumpad) return NUMPAD;
    if (lang === "korean") return shifted ? KOREAN_SHIFT : KOREAN;
    return shifted ? ENGLISH_SHIFT : ENGLISH;
  }, [showNumpad, lang, shifted]);

  const handleKey = useCallback(
    (keyValue: string) => {
      switch (keyValue) {
        case "SHIFT":
          setShifted((s) => !s);
          return;

        case "BACKSPACE":
          if (lang === "korean" && !showNumpad) {
            composer.handleBackspace();
          } else {
            if (value.length > 0) onChange(value.slice(0, -1));
          }
          return;

        case "ENTER":
          composer.flush();
          onEnter?.();
          return;

        case "LANG_EN":
          composer.flush();
          setLang("english");
          setShifted(false);
          setShowNumpad(false);
          return;

        case "LANG_KR":
          setLang("korean");
          setShifted(false);
          setShowNumpad(false);
          return;

        case "NUMPAD":
          composer.flush();
          setShowNumpad(true);
          return;

        case "LANG_PREV":
          setShowNumpad(false);
          return;

        default:
          break;
      }

      if (lang === "korean" && !showNumpad && JAMO.has(keyValue)) {
        composer.handleJamo(keyValue);
        if (shifted) setShifted(false);
      } else {
        composer.flush();
        onChange(value + keyValue);
        if (lang === "english" && shifted) setShifted(false);
      }
    },
    [lang, showNumpad, shifted, value, onChange, onEnter, composer],
  );

  return (
    <div
      className={`w-full bg-gray-100 p-2 rounded-xl select-none ${className}`}
    >
      {layout.map((row, rowIdx) => (
        <div key={rowIdx} className="flex gap-1.5 mb-1.5 last:mb-0">
          {row.map((keyDef) => (
            <KeyboardKey
              key={keyDef.value + keyDef.label}
              label={keyDef.label}
              value={keyDef.value}
              width={keyDef.width}
              variant={keyDef.variant}
              active={keyDef.value === "SHIFT" && shifted}
              onPress={handleKey}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
