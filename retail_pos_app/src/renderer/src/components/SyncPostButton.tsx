import { useState } from "react";

export default function SyncPostButton() {
  const [loading, setLoading] = useState(false);

  const handleSync = () => {
    if (loading) return;
    setLoading(true);
    const channel = new BroadcastChannel("pos-refresh");
    channel.postMessage("refresh");
    channel.close();
    setTimeout(() => setLoading(false), 1000);
  };

  return (
    <button
      onClick={handleSync}
      disabled={loading}
      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
    >
      Posts
    </button>
  );
}
