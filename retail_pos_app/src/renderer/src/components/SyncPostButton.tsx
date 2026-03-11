import React, { useEffect, useRef, useState } from "react";
import { getCloudPosts } from "../service/cloud.service";
import { CloudPost } from "../types/models";

export default function SyncPostButton() {
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<CloudPost[]>([]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const { result, ok, msg } = await getCloudPosts();
        if (ok && result) {
          setPosts(result);
        } else {
          console.log(msg || "Failed to sync posts");
        }
      } catch (e) {
        console.error(e);
        console.log("Failed to sync posts");
      } finally {
        setLoading(false);
      }
    };
    init();

    channelRef.current = new BroadcastChannel("pos-posts");
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!channelRef.current) return;
    channelRef.current.postMessage({ posts });
  }, [channelRef, posts]);

  const handleSync = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { msg, result, ok } = await getCloudPosts();
      if (ok && result) {
        window.alert(msg);
      } else {
        window.alert(msg);
      }
    } catch (e) {
      console.error(e);
      window.alert("Failed to sync posts");
    } finally {
      setLoading(false);
    }
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
