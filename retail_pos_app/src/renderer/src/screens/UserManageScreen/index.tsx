import { useCallback, useEffect, useState } from "react";
import { getUsers } from "../../service/user.service";
import { User } from "../../types/models";
import { PagingType } from "../../libs/api";
import { cn } from "../../libs/cn";
import UserForm from "../../components/user/UserForm";
import { FaArrowUp, FaArrowDown } from "react-icons/fa6";
import { Link } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import BlockScreen from "../../components/BlockScreen";
import hasScope from "../../libs/scope-utils";

export default function UserManageScreen() {
  const { user, loading: userLoading } = useUser();
  const [users, setUsers] = useState<User[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const selectedUser = users.find((u) => u.id === selectedId) ?? null;

  const fetchUsers = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getUsers(`?page=${p}`);
      if (res.ok && res.result) {
        setUsers(res.result);
        setPaging(res.paging);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(page);
  }, [page, fetchUsers]);

  const handleSave = () => {
    setCreating(false);
    setSelectedId(null);
    fetchUsers(page);
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

        <div className="flex-1 overflow-hidden">
          <div className="h-full divide-y divide-gray-200 overflow-y-auto">
            {users.map((user) => (
              <div
                key={user.id}
                onClick={() => handleSelectUser(user.id)}
                className={cn(
                  "flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors",
                  selectedId === user.id && "bg-blue-50",
                )}
              >
                <div>
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-gray-500">{user.code}</div>
                </div>
                {user.archived && (
                  <span className="text-xs text-red-500 font-medium">
                    Archived
                  </span>
                )}
              </div>
            ))}
            {!loading && users.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                No users found
              </div>
            )}
          </div>
        </div>

        {paging && paging.totalPages > 1 && (
          <div className="h-12 flex items-center justify-center gap-2 border-t border-gray-200">
            <button
              disabled={!paging.hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="p-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <FaArrowUp size={14} />
            </button>
            <span className="text-sm font-medium min-w-[80px] text-center">
              {paging.currentPage} / {paging.totalPages}
            </span>
            <button
              disabled={!paging.hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="p-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <FaArrowDown size={14} />
            </button>
          </div>
        )}
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
