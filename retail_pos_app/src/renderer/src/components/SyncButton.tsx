import React, { useState } from "react";
import { migrateDataFromCloudServer } from "../service/cloud.service";

export default function SyncButton() {
  const [loading, setLoading] = useState(false);
  const handleSync = async () => {
    if (loading) return;

    setLoading(true);
    try {
      const { msg } = await migrateDataFromCloudServer();
      window.alert(msg);
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
        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        Sync Data from Cloud Server
      </button>
    </>
  );
}
