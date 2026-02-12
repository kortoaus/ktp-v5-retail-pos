import { useCallback, useRef } from "react";
import { assemble } from "es-hangul";

export interface HangulComposer {
  handleJamo: (jamo: string) => void;
  handleBackspace: () => void;
  flush: () => void;
}

export function useHangulComposer(
  value: string,
  onChange: (newValue: string) => void,
): HangulComposer {
  const bufferRef = useRef<string[]>([]);
  const committedLenRef = useRef(0);

  const getComposed = useCallback(() => {
    if (bufferRef.current.length === 0) return "";
    return assemble(bufferRef.current);
  }, []);

  const sync = useCallback(() => {
    const committed = value.slice(0, committedLenRef.current);
    const composed = getComposed();
    onChange(committed + composed);
  }, [value, onChange, getComposed]);

  const handleJamo = useCallback(
    (jamo: string) => {
      if (bufferRef.current.length === 0) {
        committedLenRef.current = value.length;
      }
      bufferRef.current.push(jamo);
      sync();
    },
    [value, sync],
  );

  const handleBackspace = useCallback(() => {
    if (bufferRef.current.length > 0) {
      bufferRef.current.pop();
      sync();
    } else {
      if (value.length > 0) {
        onChange(value.slice(0, -1));
        committedLenRef.current = Math.max(0, committedLenRef.current - 1);
      }
    }
  }, [value, onChange, sync]);

  const flush = useCallback(() => {
    if (bufferRef.current.length > 0) {
      const committed = value.slice(0, committedLenRef.current);
      const composed = getComposed();
      const flushed = committed + composed;
      bufferRef.current = [];
      committedLenRef.current = flushed.length;
      onChange(flushed);
    }
  }, [value, onChange, getComposed]);

  return { handleJamo, handleBackspace, flush };
}
