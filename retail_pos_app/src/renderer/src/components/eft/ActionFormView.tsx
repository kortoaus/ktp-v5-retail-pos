// Generic Action Framework renderer (retail-eftpos T-7): paints whatever the
// terminal side sends while a card payment waits on the POS (AWAITING_POS) —
// rows from libs/eft/action-form.ts walkActionForm, `details` as-is. No
// transaction screen is hardcoded here. Tap targets are `div`s (scanner Enter
// suffix rule of the PaymentModal).
import { useMemo, useState } from "react";
import { cn } from "../../libs/cn";
import { actionBody, walkActionForm, type ActionElement } from "../../libs/eft/action-form";
import type { EftActionForm } from "../../libs/eft/eft-types";

export default function ActionFormView({
  form,
  version,
  disabled,
  onSubmit,
}: {
  form: EftActionForm;
  version: number;
  disabled?: boolean;
  onSubmit: (body: { buttonKey: string; inputs: Record<string, string>; version: number }) => void;
}) {
  const layout = useMemo(() => walkActionForm(form), [form]);
  const [values, setValues] = useState<Record<string, string>>({});

  function press(el: Extract<ActionElement, { kind: "button" }>) {
    if (disabled) return;
    onSubmit(actionBody(layout, el, values, version));
  }

  return (
    <div className="flex flex-col gap-2">
      {layout.rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-stretch">
          {row.map((el) => (
            <Element
              key={el.key}
              el={el}
              disabled={disabled}
              value={el.kind === "input" ? (values[el.name] ?? "") : ""}
              onChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))}
              onPress={press}
            />
          ))}
        </div>
      ))}
      {layout.details.length > 0 && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md bg-gray-50 border border-gray-200 p-2 text-xs">
          {layout.details.map((d) => (
            <div key={d.key} className="contents">
              <dt className="text-gray-500">{d.key}</dt>
              <dd className="font-mono text-gray-900 break-all">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Element({
  el,
  disabled,
  value,
  onChange,
  onPress,
}: {
  el: ActionElement;
  disabled?: boolean;
  value: string;
  onChange: (name: string, value: string) => void;
  onPress: (el: Extract<ActionElement, { kind: "button" }>) => void;
}) {
  switch (el.kind) {
    case "text":
      return <div className="flex-1 text-sm font-medium text-gray-900 whitespace-pre-line">{el.text}</div>;
    case "button":
      return (
        <div
          role="button"
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : () => onPress(el)}
          className={cn(
            "flex-1 h-12 rounded-md font-bold text-sm flex items-center justify-center select-none",
            disabled ? "bg-gray-200 text-gray-400" : "bg-blue-600 text-white active:bg-blue-700",
          )}
        >
          {el.label}
        </div>
      );
    case "input":
      return (
        <label className="flex-1 flex flex-col gap-1 text-xs text-gray-600">
          {el.label}
          <input
            className="h-10 rounded-md border border-gray-300 px-2 text-sm text-gray-900"
            type={el.inputType === "number" ? "number" : "text"}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(el.name, e.target.value)}
          />
        </label>
      );
    case "image":
      return <img src={el.src} alt={el.label || el.key} className="max-h-40 object-contain flex-1" />;
    case "unsupported":
      return <div className="flex-1 text-xs text-gray-400">[{el.type}]</div>;
  }
}
