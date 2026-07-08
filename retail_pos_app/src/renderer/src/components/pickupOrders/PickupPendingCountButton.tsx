import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import apiService from "../../libs/api";
import { cn } from "../../libs/cn";

const PICKUP_PENDING_COUNT_EVENT = "pickup-order:pending-count";

type PickupPendingCountPayload = {
  count: number;
  from: string;
  generatedAt: string;
  intervalMs: number;
};

type Props = {
  onRefresh: () => void;
};

function normalizePickupPendingCountPayload(
  next: unknown,
): PickupPendingCountPayload | null {
  if (!next || typeof next !== "object") return null;

  const maybePayload = next as Partial<PickupPendingCountPayload>;
  if (!Number.isFinite(maybePayload.count)) return null;

  return maybePayload as PickupPendingCountPayload;
}

export default function PickupPendingCountButton({ onRefresh }: Props) {
  const [payload, setPayload] = useState<PickupPendingCountPayload | null>(
    null,
  );
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const baseURL = apiService.getBaseURL();
    if (!baseURL) return;

    const socket = io(baseURL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on(PICKUP_PENDING_COUNT_EVENT, (next: unknown) => {
      const normalizedPayload = normalizePickupPendingCountPayload(next);
      if (normalizedPayload) setPayload(normalizedPayload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const label = payload ? `Pending today: ${payload.count}` : "Pending today: -";

  return (
    <button
      type="button"
      onPointerDown={onRefresh}
      className={cn(
        "h-9 min-w-[140px] whitespace-nowrap rounded-lg border px-3 text-left text-sm font-bold tabular-nums active:bg-blue-100",
        connected
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-gray-200 bg-gray-100 text-gray-500 opacity-70",
      )}
      title={connected ? "Refresh pickup orders" : "Socket reconnecting"}
    >
      {label}
    </button>
  );
}
