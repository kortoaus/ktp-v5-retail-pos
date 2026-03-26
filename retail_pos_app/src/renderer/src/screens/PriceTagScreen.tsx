import { useState } from "react";
import { Link } from "react-router-dom";
import SyncButton from "../components/SyncButton";
import PrintItemPriceTag from "../components/priceTags/PrintItemPriceTag";

type Mode = "item" | "promotion";

export default function PriceTagScreen() {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("item");

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link
          to="/"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          &larr; Back
        </Link>

        <div className="flex-1 flex justify-end">
          <SyncButton />
        </div>
        {loading && <span className="text-sm text-gray-400">Loading...</span>}
      </div>

      {/* Content */}
      <div className="flex-1 bg-gray-100">
        {mode === "item" && <PrintItemPriceTag />}
      </div>
    </div>
  );
}
