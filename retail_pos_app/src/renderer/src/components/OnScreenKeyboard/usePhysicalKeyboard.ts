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
