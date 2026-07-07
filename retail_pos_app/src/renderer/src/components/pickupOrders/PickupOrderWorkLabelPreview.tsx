import {
  formatPickupQty,
  formatPickupTime,
} from "./pickup-order-format";
import type {
  PickupOrderDetail,
  PickupOrderLine,
} from "./pickup-order-types";

type Props = {
  order: PickupOrderDetail;
  line: PickupOrderLine;
};

const PREP_CHECKS = [
  "Built",
  "Checked",
  "Sauces",
  "Cold pack",
  "Member",
  "Handoff",
] as const;

export default function PickupOrderWorkLabelPreview({ order, line }: Props) {
  const primaryItemName = line.name_ko || line.name_en || line.code || line.barcode;
  const secondaryItemName = line.name_en || line.code || "";
  const phoneLast4 = order.memberPhoneLast4 ? `*${order.memberPhoneLast4}` : "-";

  return (
    <div className="w-[100mm] h-[100mm] bg-white text-black border border-gray-300 p-3 font-mono overflow-hidden">
      <div className="flex h-full flex-col gap-2">
        <header className="border-b-2 border-black pb-1">
          <div className="text-[18px] font-black leading-none tracking-wide">
            PICKUP WORK ORDER
          </div>
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-2 text-[10px] leading-tight">
            <span className="min-w-0 truncate">
              {formatPickupTime(order.pickupStartsAt)}
            </span>
            <span className="min-w-0 max-w-[38mm] truncate text-right font-bold">
              {order.documentId}
            </span>
          </div>
        </header>

        <section className="grid grid-cols-[1fr_auto] gap-2 border-b border-black pb-1 text-[10px] leading-tight">
          <div>
            <div className="font-bold">
              LINE {line.index} / {order.status}
            </div>
            <div className="truncate">
              {order.memberName} {phoneLast4}
            </div>
          </div>
          <div className="text-right text-[16px] font-black leading-none">
            {formatPickupQty(line.qty, line.uom)}
          </div>
        </section>

        <section className="border-b border-black pb-1 leading-tight">
          <div className="truncate text-[16px] font-black">
            {primaryItemName}
          </div>
          <div className="truncate text-[10px] font-bold">
            {secondaryItemName || line.barcode}
          </div>
        </section>

        <section className="max-h-[23mm] overflow-hidden border-b border-black pb-1 text-[9px] leading-tight">
          {line.selectedOptionsSnapshot.length > 0 ? (
            line.selectedOptionsSnapshot.map((group) => {
              const groupLabel = group.name_ko || group.name_en || group.key;
              return (
                <div key={group.optionGroupId} className="mb-0.5">
                  <span className="font-black">{groupLabel}: </span>
                  <span>
                    {group.selectedOptions.map((option, index) => {
                      const optionLabel =
                        option.name_ko || option.name_en || option.key;
                      const separator =
                        index === group.selectedOptions.length - 1 ? "" : ", ";
                      return `${optionLabel} x${formatPickupQty(
                        option.qty,
                        "",
                      )}${separator}`;
                    })}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="font-bold">NO OPTIONS</div>
          )}
        </section>

        <section className="min-h-[14mm] border-2 border-black p-1 leading-tight">
          <div className="text-[9px] font-black">CUSTOMER NOTE</div>
          <div className="line-clamp-3 text-[11px] font-black">
            {line.note || "NO CUSTOMER NOTE"}
          </div>
        </section>

        <section className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] font-bold leading-none">
          {PREP_CHECKS.map((label) => (
            <div key={label} className="flex items-center gap-1">
              <span className="inline-block size-3 border-2 border-black" />
              <span>{label}</span>
            </div>
          ))}
        </section>

        <section className="mt-auto grid grid-cols-[22mm_1fr] gap-2 border-t border-black pt-1">
          <div className="flex aspect-square items-center justify-center border-2 border-black text-center text-[8px] font-black leading-tight">
            QR /
            <br />
            DATA
          </div>
          <div className="flex flex-col justify-center overflow-hidden text-[9px] font-bold leading-tight">
            <div>pickup-order-line</div>
            <div className="truncate">{order.documentId}</div>
            <div>
              CRM {order.crmOrderId} / LINE {line.crmLineId}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
