// OrderViewer 섹션 ③ Picking — 옵션 없는 라인(단순 피킹). 한 줄:
// 명칭·수량·금액. 슬라이스 C 피킹 리스트 ESC/POS 대상 집합과 1:1.

import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import type { OrderLine } from "../../service/order.service";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

export default function OrderViewerPickingSection({
  lines,
}: {
  lines: OrderLine[];
}) {
  return (
    <div className="p-4 border-b border-gray-300">
      <div className="font-bold mb-2">Picking ({lines.length})</div>
      {lines.length === 0 && <div className="text-gray-400">None</div>}
      <div className="space-y-1">
        {lines.map((line) => (
          <div key={line.id} className="flex items-center gap-3 text-base">
            <span className="flex-1 min-w-0">
              {line.name_en}
              {line.name_ko && (
                <span className="text-gray-500"> {line.name_ko}</span>
              )}
            </span>
            <span className="shrink-0 font-bold">×{line.qty}</span>
            <span className="w-24 shrink-0 text-right font-mono">
              ${fmtMoney(line.lineTotal)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
