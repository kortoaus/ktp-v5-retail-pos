import { useCallback, useEffect, useState } from "react";
import { getCashIOs } from "../../service/cashio.service";
import { CashInOut } from "../../types/models";
import { PagingType } from "../../libs/api";
import { cn } from "../../libs/cn";
import CashIOForm from "../../components/cashio/CashIOForm";
import ServerPagingList from "../../components/list/ServerPagingList";
import { Link } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import BlockScreen from "../../components/BlockScreen";
import hasScope from "../../libs/scope-utils";
import KeyboardInputText from "../../components/KeyboardInputText";
import DateRangeSelector from "../../components/DateRangeSelector";
import type { Dayjs } from "dayjs";

const PAGE_SIZE = 8;

export default function CashIOManageScreen() {
  const { user, loading: userLoading } = useUser();
  const [records, setRecords] = useState<CashInOut[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState<Dayjs | null>(null);
  const [to, setTo] = useState<Dayjs | null>(null);

  const fetchRecords = useCallback(
    async (p: number, kw: string, f: Dayjs | null, t: Dayjs | null) => {
      try {
        const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
        if (kw) params.set("keyword", kw);
        if (f) params.set("from", String(f.valueOf()));
        if (t) params.set("to", String(t.valueOf()));
        const res = await getCashIOs(`?${params}`);
        if (res.ok && res.result) {
          setRecords(res.result);
          setPaging(res.paging);
        }
      } finally {
      }
    },
    [],
  );

  useEffect(() => {
    fetchRecords(page, keyword, from, to);
  }, [page, fetchRecords]);

  const handleSave = () => {
    setCreating(false);
    fetchRecords(page, keyword, from, to);
  };

  const handleCancel = () => {
    setCreating(false);
  };

  const handleSearch = () => {
    setPage(1);
    fetchRecords(1, keyword, from, to);
  };

  const handleCreate = () => {
    setCreating(true);
  };

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!user || !hasScope(user.scope, ["cashio"])) {
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
            <h2 className="text-lg font-bold">Cash In / Out</h2>
          </div>
          <button
            onClick={handleCreate}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            New
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-200 flex flex-col gap-2">
          <div className="flex gap-2">
            <KeyboardInputText
              value={keyword}
              onChange={setKeyword}
              onEnter={handleSearch}
              placeholder="Search by name or note..."
              className="flex-1"
            />
            <button
              type="button"
              onPointerDown={handleSearch}
              className="rounded-lg bg-gray-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors shrink-0"
            >
              Search
            </button>
          </div>
          <DateRangeSelector
            from={from}
            to={to}
            setVal={(f, t) => { setFrom(f); setTo(t); }}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <ServerPagingList
            rows={records}
            pageSize={PAGE_SIZE}
            paging={paging}
            onPageChange={setPage}
            Renderer={({ item: record }) => (
              <div className="flex items-center justify-between px-4 py-3 h-full">
                <div>
                  <div className="text-sm font-medium">
                    <span
                      className={cn(
                        "inline-block w-14 text-center rounded px-1.5 py-0.5 text-xs font-semibold mr-2",
                        record.type === "in"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700",
                      )}
                    >
                      {record.type === "in" ? "IN" : "OUT"}
                    </span>
                    ${record.amount.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {record.userName}
                    {record.note ? ` — ${record.note}` : ""}
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  {new Date(record.createdAt).toLocaleTimeString()}
                </div>
              </div>
            )}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {creating ? (
          <CashIOForm onSave={handleSave} onCancel={handleCancel} />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Press New to create a cash in/out record
          </div>
        )}
      </div>
    </div>
  );
}
