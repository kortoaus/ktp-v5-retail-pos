import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { migrateDataFromCloudServer } from "../service/cloud.service";
import apiService from "../libs/api";

export default function SyncButton() {
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const baseURL = apiService.getBaseURL();
    if (!baseURL) return;

    const socket = io(baseURL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("cloud-sync-completed", () => {
      // window.alert(
      //   "Server data is up to date. Please refresh the page to see the latest data.",
      // );
      setStale(true);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const handleSync = async () => {
    if (loading) return;

    if (stale) {
      window.location.reload();
      return;
    }

    setLoading(true);
    try {
      const { msg } = await migrateDataFromCloudServer();
      window.alert(msg);
      window.location.reload();
    } catch (e) {
      console.error(e);
      window.alert("Failed to sync data from cloud server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {loading && (
        <div className="fixed inset-0 bg-black/25 flex flex-col items-center justify-center">
          <h1 className="text-white text-2xl font-bold animate-bounce">
            Syncing data from cloud server...
          </h1>
        </div>
      )}
      <button
        onClick={handleSync}
        disabled={loading}
        className={
          stale
            ? "bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors animate-pulse"
            : "bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        }
      >
        {stale ? "Refresh" : "Sync"}
      </button>
    </>
  );
}
