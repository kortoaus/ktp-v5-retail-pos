import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "../libs/cn";
import SyncButton from "../components/SyncButton";
import PrintItemPriceTag from "../components/priceTags/PrintItemPriceTag";
import PrintPromotionTag from "../components/priceTags/PrintPromotionTag";

type Mode = "item" | "promotion";

export default function PriceTagScreen() {
  const [mode, setMode] = useState<Mode>("item");

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link
          to="/"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          &larr; Back
        </Link>

        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <button
            onPointerDown={() => setMode("item")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              mode === "item"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700",
            )}
          >
            Item
          </button>
          <button
            onPointerDown={() => setMode("promotion")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              mode === "promotion"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700",
            )}
          >
            Promotion
          </button>
        </div>

        <div className="flex-1 flex justify-end">
          <SyncButton />
        </div>
      </div>

      <div className="flex-1 bg-gray-100">
        {mode === "item" && <PrintItemPriceTag />}
        {mode === "promotion" && <PrintPromotionTag />}
      </div>
    </div>
  );
}
