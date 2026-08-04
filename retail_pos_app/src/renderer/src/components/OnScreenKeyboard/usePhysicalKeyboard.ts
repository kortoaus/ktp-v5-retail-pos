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

// Mounted instances in mount order. Two keyboards can be visible at once
// (e.g. the KeyboardInputText overlay opened over a form with an embedded
// keyboard on CashIOManageScreen/UserManageScreen); the overlay mounts later
// and stacks on top, so the LAST visible instance is the one the user sees.
const mountedRefs: RefObject<HTMLDivElement | null>[] = [];

function topmostVisible(): RefObject<HTMLDivElement | null> | null {
  for (let i = mountedRefs.length - 1; i >= 0; i--) {
    const el = mountedRefs[i].current;
    if (el && el.offsetParent !== null) return mountedRefs[i];
  }
  return null;
}

/**
 * Feeds physical keydown events into the on-screen keyboard while its root
 * element is the topmost visible instance. Capture-phase + stopPropagation
 * keeps handled keys away from the bubble-phase barcode-scanner listener;
 * hidden instances (CSS `hidden` on multi-keyboard screens) and covered ones
 * (overlay open above an embedded keyboard) bail via topmostVisible().
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
    mountedRefs.push(rootRef);

    const handler = (e: KeyboardEvent): void => {
      if (topmostVisible() !== rootRef) return;
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
      // CapsLock affects only Latin letters, matching OS typing behavior.
      const shiftKey =
        mode === "english" && /^Key[A-Z]$/.test(e.code)
          ? e.shiftKey !== e.getModifierState("CapsLock")
          : e.shiftKey;
      const token = resolvePhysicalKey(e.code, shiftKey, mode);
      if (token === null) return;
      if (e.repeat && token === "ENTER") {
        consume();
        return;
      }
      consume();
      onKey(token);
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      const idx = mountedRefs.indexOf(rootRef);
      if (idx !== -1) mountedRefs.splice(idx, 1);
    };
  }, [rootRef]);
}
