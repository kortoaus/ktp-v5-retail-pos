import { CF_URL } from "../libs/cf-image-utils";
import { useEffect, useState } from "react";
import { CloudPost, StoreSetting } from "../types/models";
import TiptapContentRenderer from "./TiptapContentRenderer";

const POST_ROTATE_INTERVAL_MS = 5000;

export default function CustomerIdleScreen({
  storeSetting,
  posts,
}: {
  storeSetting: StoreSetting | null;
  posts: CloudPost[] | null;
}) {
  if (!storeSetting) {
    return (
      <div className="h-screen w-screen bg-yellow-400 flex items-center justify-center">
        <div className="text-lg">Connecting...</div>
      </div>
    );
  }

  const addressParts = [
    storeSetting.address1,
    storeSetting.address2,
    [storeSetting.suburb, storeSetting.state, storeSetting.postcode]
      .filter(Boolean)
      .join(" "),
  ].filter(Boolean);

  if (posts && posts.length > 0) {
    return <PostsViewer posts={posts} />;
  }

  return (
    <div className="h-screen w-screen bg-yellow-400 flex flex-col items-center justify-center gap-12">
      <div className="text-center space-y-4">
        <div className=" text-5xl font-bold">{storeSetting.name}</div>
        {addressParts.map((line, i) => (
          <div key={i} className="text-xl">
            {line}
          </div>
        ))}
        {storeSetting.phone && (
          <div className="text-xl">{storeSetting.phone}</div>
        )}
        {storeSetting.abn && (
          <div className="text-lg">ABN: {storeSetting.abn}</div>
        )}
      </div>
    </div>
  );
}

function PostsViewer({ posts }: { posts: CloudPost[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (posts.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % posts.length);
    }, POST_ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [posts.length]);

  return (
    <div className="w-screen h-screen overflow-hidden">
      <div
        className="h-full transition-transform duration-700 ease-in-out"
        style={{ transform: `translateY(-${currentIndex * 100}%)` }}
      >
        {posts.map((post) => (
          <PostViewer key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}

function PostViewer({ post }: { post: CloudPost }) {
  return (
    <div className="w-screen h-screen bg-yellow-400">
      <div className="w-full h-full flex gap-8  px-16 py-8">
        {/* Image */}
        <div className="h-full aspect-4/5 bg-gray-200 rounded-lg overflow-hidden relative shadow-2xl">
          <img
            src={CF_URL(post.imgId, "dDetail")}
            alt={post.titleEn}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 pt-4">
          <h1 className="text-4xl font-bold line-clamp-2 text-center">
            {post.titleEn}
          </h1>
          <div className="text-2xl font-medium text-center">{post.descEn}</div>
          <div className="text-2xl font-medium text-center">{post.descKo}</div>
        </div>
      </div>
    </div>
  );
}
