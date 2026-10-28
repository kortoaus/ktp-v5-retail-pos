// Settings → Payments → Diagnostics (retail-eftpos D-5, read-only): what the
// owner reads over SSH (`GET /api/eft/lanes`) plus the event log of a lane's
// last transaction (`GET /api/eft/transactions/:id/events`). Plain tables and
// a Refresh button; nothing here writes.
import { useCallback, useEffect, useState } from "react";
import { useTerminal } from "../../contexts/TerminalContext";
import { cn } from "../../libs/cn";
import dayjsAU from "../../libs/dayjsAU";
import { eftErrorText } from "../../libs/eft/eft-flow";
import type { EftEvent, EftLanes } from "../../libs/eft/eft-types";
import { fmtMoney } from "../../libs/sale/tender-queue";
import { getEftEvents, getEftLanes } from "../../service/eft.service";

const fmtAt = (iso: string | null | undefined) => (iso ? dayjsAU(iso).format("DD/MM HH:mm:ss.SSS") : "—");

export default function EftDiagnosticsTab() {
  const { terminal } = useTerminal();
  const [lanes, setLanes] = useState<EftLanes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [laneId, setLaneId] = useState<number | null>(null);
  const [events, setEvents] = useState<EftEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (target: number | null) => {
    setLoading(true);
    try {
      const res = await getEftLanes();
      if (!res.ok || !res.result) {
        setError(eftErrorText(res));
        return;
      }
      setError(null);
      setLanes(res.result);
      // Default: this till's lane, else the lane with the newest transaction.
      const list = res.result.lanes;
      const pick =
        list.find((l) => l.terminalId === (target ?? terminal?.id)) ??
        [...list].filter((l) => l.lastTransaction).sort((a, b) => (b.lastTransaction?.at ?? "").localeCompare(a.lastTransaction?.at ?? ""))[0] ??
        null;
      setLaneId(pick?.terminalId ?? null);
      const txnId = pick?.lastTransaction?.id;
      if (!txnId) {
        setEvents(null);
        setEventsError(null);
        return;
      }
      const ev = await getEftEvents(txnId);
      if (ev.ok && ev.result) {
        setEvents(ev.result);
        setEventsError(null);
      } else {
        setEvents(null);
        setEventsError(eftErrorText(ev));
      }
    } finally {
      setLoading(false);
    }
  }, [terminal?.id]);

  useEffect(() => {
    void refresh(null);
  }, [refresh]);

  const lane = lanes?.lanes.find((l) => l.terminalId === laneId) ?? null;

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      <div className="flex items-center gap-4 text-sm">
        <button
          type="button"
          onClick={() => void refresh(laneId)}
          disabled={loading}
          className="h-10 px-5 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {lanes && (
          <>
            <span className="text-gray-600">
              Server time <span className="font-mono">{lanes.serverTime}</span>
            </span>
            <span className="text-gray-600">
              Configured: pairing <b>{lanes.configured.pairing ? "yes" : "no"}</b> · signing{" "}
              <b>{lanes.configured.signing ? "yes" : "no"}</b>
            </span>
            <span className="text-gray-600">Active loops {lanes.activeLoops}</span>
          </>
        )}
      </div>
      {error && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {lanes && (
        <table className="w-full text-xs bg-white border border-gray-200">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              {["Lane", "IP", "Terminal (nickname / TID)", "Paired", "SCI reachable", "Last OK", "Last error", "Last transaction"].map((h) => (
                <th key={h} className="text-left px-2 py-1.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lanes.lanes.map((l) => (
              <tr
                key={l.terminalId}
                onClick={() => void refresh(l.terminalId)}
                className={cn("border-t border-gray-100 cursor-pointer", l.terminalId === laneId && "bg-blue-50")}
              >
                <td className="px-2 py-1.5">
                  {l.name ?? "—"} <span className="text-gray-400">#{l.terminalId}</span>
                  {l.terminalId === terminal?.id && <span className="ml-1 text-blue-600">(this till)</span>}
                </td>
                <td className="px-2 py-1.5 font-mono">{l.ipAddress ?? "—"}</td>
                <td className="px-2 py-1.5">
                  {l.pairing ? `${l.pairing.nickname ?? l.pairing.terminalNickname ?? "—"} / ${l.pairing.tid ?? "—"}` : "none (keyed)"}
                </td>
                <td className="px-2 py-1.5">{l.pairing ? (l.pairing.active ? "yes" : `no (${l.pairing.lastError ?? "—"})`) : "—"}</td>
                <td className="px-2 py-1.5">{l.sciReachable == null ? "—" : l.sciReachable ? "yes" : "NO"}</td>
                <td className="px-2 py-1.5 font-mono">{fmtAt(l.lastSciOkAt)}</td>
                <td className="px-2 py-1.5 font-mono">
                  {l.lastSciErrorAt ? `${fmtAt(l.lastSciErrorAt)} ${l.lastSciErrorCode ?? ""}` : "—"}
                </td>
                <td className="px-2 py-1.5 font-mono">
                  {l.lastTransaction
                    ? `${l.lastTransaction.status}${l.lastTransaction.financialStatus ? ` ${l.lastTransaction.financialStatus}` : ""}${
                        l.lastTransaction.errorClass ? ` [${l.lastTransaction.errorClass}] ${l.lastTransaction.errorCode ?? ""}` : ""
                      } $${fmtMoney(l.lastTransaction.amountCents)} ${fmtAt(l.lastTransaction.at)}`
                    : "—"}
                </td>
              </tr>
            ))}
            {lanes.lanes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-3 text-gray-500">
                  No lanes
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div className="text-sm font-semibold text-gray-700">
        Last transaction events{lane?.lastTransaction ? ` — ${lane.lastTransaction.id}` : ""}
      </div>
      {eventsError && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{eventsError}</div>}
      {!lane?.lastTransaction && !eventsError && <div className="text-xs text-gray-500">No transaction on this lane yet.</div>}
      {events && (
        <table className="w-full text-xs bg-white border border-gray-200">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              {["Seq", "At", "Source", "Event", "Status", "Error class", "Error code", "HTTP", "ms"].map((h) => (
                <th key={h} className="text-left px-2 py-1.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {events.map((e) => (
              <tr key={e.seq} className="border-t border-gray-100">
                <td className="px-2 py-1">{e.seq}</td>
                <td className="px-2 py-1">{fmtAt(e.at)}</td>
                <td className="px-2 py-1">{e.source}</td>
                <td className="px-2 py-1">{e.event}</td>
                <td className="px-2 py-1">{e.statusBefore || e.statusAfter ? `${e.statusBefore ?? ""} → ${e.statusAfter ?? ""}` : ""}</td>
                <td className="px-2 py-1">{e.errorClass ?? ""}</td>
                <td className="px-2 py-1">{e.errorCode ?? ""}</td>
                <td className="px-2 py-1">
                  {e.httpStatus ?? ""}
                  {e.httpMethod ? ` ${e.httpMethod} ${e.httpPath ?? ""}` : ""}
                </td>
                <td className="px-2 py-1">{e.durationMs ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
