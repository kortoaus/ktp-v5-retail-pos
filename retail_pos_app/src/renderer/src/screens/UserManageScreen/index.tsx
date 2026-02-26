import { useCallback, useEffect, useState } from "react";
import { getUsers } from "../../service/user.service";
import { User } from "../../types/models";
import { PagingType } from "../../libs/api";
import { cn } from "../../libs/cn";
import UserForm from "../../components/user/UserForm";
import ServerPagingList from "../../components/list/ServerPagingList";
import { Link } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import BlockScreen from "../../components/BlockScreen";
import hasScope from "../../libs/scope-utils";
import KeyboardInputText from "../../components/KeyboardInputText";

const PAGE_SIZE = 8;

export default function UserManageScreen() {
  const { user, loading: userLoading } = useUser();
  const [users, setUsers] = useState<User[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState("");

  const selectedUser = users.find((u) => u.id === selectedId) ?? null;

  const fetchUsers = useCallback(async (p: number, kw: string) => {
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (kw) params.set("keyword", kw);
      const res = await getUsers(`?${params}`);
      if (res.ok && res.result) {
        setUsers(res.result);
        setPaging(res.paging);
      }
    } finally {
    }
  }, []);

  useEffect(() => {
    fetchUsers(page, keyword);
  }, [page, fetchUsers]);

  const handleSave = () => {
    setCreating(false);
    setSelectedId(null);
    fetchUsers(page, keyword);
  };

  const handleCancel = () => {
    setCreating(false);
    setSelectedId(null);
  };

  const handleSelectUser = (id: number) => {
    setCreating(false);
    setSelectedId(id === selectedId ? null : id);
  };

  const handleCreate = () => {
    setSelectedId(null);
    setCreating(true);
  };

  const editingUser = creating ? null : selectedUser;
  const showForm = creating || selectedUser !== null;

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!user || !hasScope(user.scope, ["user"])) {
    return (
      <BlockScreen
        label="You are not authorized to access this page"
        link="/"
      />
    );
  }

  return (
    <div className="h-full flex">
      <div className="w-[400px] flex flex-col border-r border-gray-200">
        <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              &larr; Back
            </Link>
            <h2 className="text-lg font-bold">Users</h2>
          </div>
          <button
            onClick={handleCreate}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            New
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-200 flex gap-2">
          <KeyboardInputText
            value={keyword}
            onChange={setKeyword}
            onEnter={() => { setPage(1); fetchUsers(1, keyword); }}
            placeholder="Search users..."
            className="flex-1"
          />
          <button
            type="button"
            onPointerDown={() => { setPage(1); fetchUsers(1, keyword); }}
            className="rounded-lg bg-gray-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors shrink-0"
          >
            Search
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <ServerPagingList
            rows={users}
            pageSize={PAGE_SIZE}
            paging={paging}
            onPageChange={setPage}
            Renderer={({ item: u }) => (
              <div
                onClick={() => handleSelectUser(u.id)}
                className={cn(
                  "flex items-center justify-between px-4 py-3 h-full cursor-pointer hover:bg-gray-50 transition-colors",
                  selectedId === u.id && "bg-blue-50",
                )}
              >
                <div>
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="text-xs text-gray-500">{u.code}</div>
                </div>
                {u.archived && (
                  <span className="text-xs text-red-500 font-medium">
                    Archived
                  </span>
                )}
              </div>
            )}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showForm ? (
          <UserForm
            origin={editingUser}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Select a user or create new
          </div>
        )}
      </div>
    </div>
  );
}
