// 페이지 내 확인 다이얼로그 (window.confirm 대체 — 일괄 Schedule/Dispatch·행 Schedule,
// 트리아지 스펙 §6.4·§6.5). 상단 앵커, 키보드 없음. onPointerDown 만 사용.

import type { BulkConfirmText } from "./delivery-bulk";

export default function TriageConfirmDialog({
  text,
  tone = "blue",
  onCancel,
  onConfirm,
}: {
  text: BulkConfirmText;
  tone?: "blue" | "red";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-24 px-4"
      style={{ zIndex: 1700 }}
      onPointerDown={onCancel}
    >
      <div
        className="bg-white rounded-xl w-full max-w-xl p-6 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-2xl font-bold">{text.title}</div>
        <div className="mt-3 space-y-1">
          {text.lines.map((line, i) => (
            <div key={line} className={i === 0 ? "text-lg font-semibold" : "text-base text-gray-600"}>
              {line}
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onPointerDown={onCancel}
            className="flex-1 h-14 rounded-lg bg-gray-200 text-lg font-bold active:bg-gray-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onPointerDown={onConfirm}
            className={
              "flex-1 h-14 rounded-lg text-white text-lg font-bold " +
              (tone === "red" ? "bg-red-600 active:bg-red-700" : "bg-blue-600 active:bg-blue-700")
            }
          >
            {text.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
