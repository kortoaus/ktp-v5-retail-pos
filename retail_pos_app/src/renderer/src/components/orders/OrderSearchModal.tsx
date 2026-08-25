// S3-b — 세일스크린 온라인 주문 검색 모달
// (specs/2026-08-26-pos-order-search-load-design.md §4).
//
// 관례는 MemberSearchModal 복사: 고정 backdrop(z999), 좌 결과 / 우
// OnScreenKeyboard, 모든 조작 onPointerDown, 물리 키보드 미사용
// (스캐너 Enter 트랩 회피). 행 5슬롯 고정 + Prev/n·total/Next.
//
// 이 모달은 조회만 한다 — 선택 시 onClose() 후 onSelect(id) 로 넘기고,
// 확인 다이얼로그·가드·주입은 전부 useOrderLoad(§1) 가 담당한다.

import { useCallback, useEffect, useState } from "react";
import type { PagingType } from "../../libs/api";
import { MONEY_DP, MONEY_SCALE } from "../../libs/constants";
import { getOrders, type OrderSummary } from "../../service/order.service";
import OnScreenKeyboard from "../OnScreenKeyboard";
import { StatusBadge } from "./order-badges";

const PAGE_SIZE = 5;

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

interface OrderSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (orderId: number) => void;
}

export default function OrderSearchModal({
  open,
  onClose,
  onSelect,
}: OrderSearchModalProps) {
  const [keyword, setKeyword] = useState("");
  // 페이징이 검색 당시 키워드를 유지하도록 입력 버퍼와 분리한다.
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [items, setItems] = useState<OrderSummary[]>([]);
  const [paging, setPaging] = useState<PagingType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchPage = useCallback(async (page: number, searchTerm: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        preset: "active",
        fulfillment: "CLICK_AND_COLLECT",
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      // keyword 가 있으면 서버가 preset 을 무시하고 종결 상태를 제외한다 (§3).
      if (searchTerm) params.set("keyword", searchTerm);
      const res = await getOrders(`?${params}`);
      if (res.ok && res.result) {
        setItems(res.result);
        setPaging(res.paging);
        if (res.result.length === 0) setError("No open orders");
      } else {
        setItems([]);
        setPaging(null);
        // 서버 거부(ok:false)는 msg 를 그대로 안내문으로 노출한다(알럿 금지).
        setError(res.msg || "No open orders");
      }
    } catch {
      setItems([]);
      setPaging(null);
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  // 열 때마다 초기화 + 기본 목록(활성 C&C) 재조회.
  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setAppliedKeyword("");
    setItems([]);
    setPaging(null);
    setError("");
    void fetchPage(1, "");
  }, [open, fetchPage]);

  const handleSearch = useCallback(() => {
    const term = keyword.trim().replace(/\s+/g, " ");
    setKeyword(term);
    setAppliedKeyword(term);
    void fetchPage(1, term);
  }, [keyword, fetchPage]);

  const handleSelect = useCallback(
    (orderId: number) => {
      onClose();
      onSelect(orderId);
    },
    [onClose, onSelect],
  );

  if (!open) return null;

  const currentPage = paging?.currentPage ?? 1;
  const totalPages = Math.max(1, paging?.totalPages ?? 1);
  const hasPrev = paging?.hasPrev ?? false;
  const hasNext = paging?.hasNext ?? false;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-[1180px] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <h2 className="text-lg font-bold">Online Orders</h2>
          <button
            type="button"
            onPointerDown={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* 좌 결과 / 우 OnScreenKeyboard — MemberSearchModal 과 동일 관례.
            주문 행은 필드가 많아 결과 열을 넓게 잡는다. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 p-4">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12">
                <span className="text-gray-400 text-lg">🔎</span>
                <div className="flex-1 text-lg min-h-[28px] truncate">
                  {keyword || (
                    <span className="text-gray-400">
                      Full phone, order no. or name
                    </span>
                  )}
                </div>
                {keyword && (
                  <button
                    type="button"
                    onPointerDown={() => setKeyword("")}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="button"
                onPointerDown={handleSearch}
                disabled={loading}
                className="w-32 shrink-0 h-12 rounded-lg bg-blue-600 text-white font-semibold active:bg-blue-700 disabled:opacity-40 text-sm"
              >
                {loading ? "Searching..." : "Search"}
              </button>
            </div>

            {/* 결과 — 5슬롯 고정 (행 수가 바뀌어도 레이아웃이 튀지 않게) */}
            <div className="h-[360px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  Searching...
                </div>
              ) : items.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm text-center px-4">
                  {error || "No open orders"}
                </div>
              ) : (
                <div className="h-full grid grid-rows-5 gap-2">
                  {items.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="h-10 flex items-center justify-between gap-2">
              <button
                type="button"
                onPointerDown={() => {
                  if (hasPrev && !loading) {
                    void fetchPage(currentPage - 1, appliedKeyword);
                  }
                }}
                disabled={!hasPrev || loading}
                className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
              >
                Prev
              </button>
              <span className="text-sm text-gray-500">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                onPointerDown={() => {
                  if (hasNext && !loading) {
                    void fetchPage(currentPage + 1, appliedKeyword);
                  }
                }}
                disabled={!hasNext || loading}
                className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
              >
                Next
              </button>
            </div>
          </div>

          <div className="border-l border-gray-200 pl-4 flex items-start">
            <OnScreenKeyboard
              key="order-search-keyword"
              value={keyword}
              onChange={setKeyword}
              onEnter={handleSearch}
              initialLayout="english"
              className="shrink-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderRow({
  order,
  onSelect,
}: {
  order: OrderSummary;
  onSelect: (orderId: number) => void;
}) {
  return (
    <div
      onPointerDown={() => onSelect(order.id)}
      className="w-full min-h-0 bg-gray-50 rounded-xl px-4 flex items-center gap-3 cursor-pointer active:bg-blue-50"
    >
      <StatusBadge status={order.status} />
      <span className="w-32 shrink-0 font-mono text-sm">{order.orderNo}</span>
      <span className="flex-1 min-w-0 truncate font-bold">
        {order.memberName}
      </span>
      <span className="w-20 shrink-0 text-sm text-gray-500">
        ***{order.memberPhoneLast3}
      </span>
      <span className="w-24 shrink-0 text-right font-mono font-bold">
        ${fmtMoney(order.total)}
      </span>
    </div>
  );
}
