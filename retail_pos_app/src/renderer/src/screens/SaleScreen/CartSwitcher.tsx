import React from "react";
import { useStore } from "zustand";
import { useSalesStore } from "../../store/salesStore";
import { cn } from "../../libs/cn";

export default function CartSwitcher() {
  const { activeCartIndex, switchCart, cartCount } = useSalesStore();

  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: cartCount }).map((_, index) => (
        <button
          key={index}
          onClick={() => switchCart(index)}
          className={cn(
            "w-24 h-10 rounded-sm bg-gray-200 text-lg font-bold",
            activeCartIndex === index
              ? "bg-blue-500 text-white"
              : "bg-gray-200",
          )}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}
