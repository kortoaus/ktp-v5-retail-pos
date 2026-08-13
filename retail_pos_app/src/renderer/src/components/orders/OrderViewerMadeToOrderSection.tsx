// OrderViewer 섹션 ② Made to Order — 옵션 보유 라인(제작 상품).
// 판별자(오너 확정): line.options.length > 0. 옵션 브레이크다운은 항상 펼침
// (그룹명·옵션명·수량·priceDelta) — 슬라이스 C 작업지시서 ZPL 대상 집합과 1:1.

import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import type { OrderLine } from "../../service/order.service";

const fmtMoney = (cents: number) =>
  (Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP);

function fmtDelta(cents: number): string {
  if (cents === 0) return "";
  return ` (${cents > 0 ? "+" : "-"}$${fmtMoney(cents)})`;
}

export default function OrderViewerMadeToOrderSection({
  lines,
}: {
  lines: OrderLine[];
}) {
  return (
    <div className="p-4 border-b border-gray-300">
      <div className="font-bold mb-2">Made to Order ({lines.length})</div>
      {lines.length === 0 && <div className="text-gray-400">None</div>}
      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.id}>
            <div className="flex justify-between gap-3 text-base">
              <span>
                {line.name_en}
                {line.name_ko && (
                  <span className="text-gray-500"> {line.name_ko}</span>
                )}
              </span>
              <span className="shrink-0 font-bold">×{line.qty}</span>
            </div>
            <div className="pl-4">
              {line.options.map((option, i) => (
                <div key={i} className="flex justify-between gap-3 text-sm">
                  <span>
                    {option.groupName_en && (
                      <span className="text-gray-500">
                        {option.groupName_en}:{" "}
                      </span>
                    )}
                    {option.optionName_en}
                    {option.optionName_ko && (
                      <span className="text-gray-500">
                        {" "}
                        {option.optionName_ko}
                      </span>
                    )}
                    {fmtDelta(option.priceDelta)}
                  </span>
                  <span className="shrink-0">×{option.qty}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
