import { ReactNode, useState } from "react";
import { useSearchParams } from "react-router-dom";

type ListPageSearchProps = {
  action?: ReactNode;
};

export default function ListPageSearch({ action }: ListPageSearchProps) {
  const [searchParams] = useSearchParams();
  const initKeyword = searchParams.get("keyword") ?? "";
  const [keyword, setKeyword] = useState(initKeyword);

  return (
    <div className="bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-4">
        <form className="flex-1 max-w-[400px]">
          <div className="relative">
            <input
              name="keyword"
              type="text"
              placeholder="Search..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-700"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 15 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 6.5C10 8.433 8.433 10 6.5 10C4.567 10 3 8.433 3 6.5C3 4.567 4.567 3 6.5 3C8.433 3 10 4.567 10 6.5ZM9.244 10.159a4.5 4.5 0 1 1 .915-.915l3.299 3.298-.916.916-3.298-3.299Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </form>
        {action}
      </div>
    </div>
  );
}
