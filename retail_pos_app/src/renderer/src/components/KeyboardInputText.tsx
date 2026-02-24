import { useState } from "react";
import OnScreenKeyboard from "./OnScreenKeyboard";

interface KeyboardInputTextProps {
  value: string;
  onChange: (newValue: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  initialLayout?: "korean" | "english" | "numpad";
  className?: string;
}

export default function KeyboardInputText({
  value,
  onChange,
  onEnter,
  placeholder,
  initialLayout,
  className = "",
}: KeyboardInputTextProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={`h-9 rounded-lg border border-gray-300 text-sm flex items-center cursor-pointer ${className}`}
      >
        <div
          onPointerDown={() => setOpen(true)}
          className="flex-1 h-full px-3 flex items-center min-w-0"
        >
          {value || (
            <span className="text-gray-400">
              {placeholder ?? "Tap to type"}
            </span>
          )}
        </div>
        {value && (
          <button
            type="button"
            onPointerDown={() => onChange("")}
            className="w-8 h-full flex items-center justify-center text-gray-400 active:text-gray-600 shrink-0"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex flex-col items-center justify-end"
          style={{ zIndex: 1000 }}
        >
          <div
            className="flex-1 w-full flex items-center justify-center"
            onPointerDown={() => {
              setOpen(false);
              onEnter?.();
            }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl px-6 py-4 min-w-[300px] max-w-xl flex items-center gap-3"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="text-2xl min-h-[40px] flex-1">
                {value || (
                  <span className="text-gray-300">
                    {placeholder ?? "Type..."}
                  </span>
                )}
              </div>
              {value && (
                <button
                  type="button"
                  onPointerDown={() => onChange("")}
                  className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 active:bg-gray-200 text-xl shrink-0"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="w-full max-w-3xl pb-4 px-4">
            <OnScreenKeyboard
              value={value}
              onChange={onChange}
              initialLayout={initialLayout}
              onEnter={() => {
                setOpen(false);
                onEnter?.();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
