import React from "react";

export default function LoadingOverlay({
  label = "Loading...",
}: {
  label?: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/25 flex items-center justify-center"
      style={{ zIndex: 9999 }}
    >
      <h1 className="text-white text-2xl font-bold animate-bounce">{label}</h1>
    </div>
  );
}
