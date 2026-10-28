// Integrated EFTPOS lane API — retail_pos_server `/api/eft/*` (T-6;
// terminalMiddleware → userMiddleware → scope "sale"). The till never talks
// to the payment service itself: the store server holds every key and runs the
// terminal loop; this lane only creates, long-polls, relays buttons and the
// override, and reads diagnostics (retail-eftpos D-2..D-5, T-7).
// Long poll (D-4): GET /transactions/:id?min_version=N is held ≤ 20 s by the
// server and always answers 200 (the axios timeout is 30 s).
import apiService, { ApiResponse } from "../libs/api";
import type {
  EftEvent,
  EftLanes,
  EftPairing,
  EftPairingTest,
  EftPairResult,
  EftTxn,
} from "../libs/eft/eft-types";
import type { EftLaneApi } from "../libs/eft/eft-flow";

export async function listEftPairings(): Promise<ApiResponse<EftPairing[]>> {
  return apiService.get<EftPairing[]>("/api/eft/pairings");
}

export async function pairEftTerminal(body: {
  pairingCode: string;
  nickname?: string;
}): Promise<ApiResponse<EftPairResult>> {
  return apiService.post<EftPairResult>("/api/eft/pairings", body);
}

export async function testEftPairing(id: number): Promise<ApiResponse<EftPairingTest>> {
  return apiService.post<EftPairingTest>(`/api/eft/pairings/${id}/test`);
}

export async function unpairEftPairing(id: number): Promise<ApiResponse<{ ok: boolean }>> {
  return apiService.post<{ ok: boolean }>(`/api/eft/pairings/${id}/unpair`);
}

/** The operator's pick for this lane; `null` clears it (`/select` with id "none"). */
export async function selectEftPairing(
  id: number | null,
): Promise<ApiResponse<{ terminalId: number; eftPairingId: number | null }>> {
  return apiService.post(`/api/eft/pairings/${id ?? "none"}/select`);
}

export async function createEftTransaction(body: {
  operationId: string;
  kind: "PURCHASE";
  amountCents: number;
  surchargeCents: number;
}): Promise<ApiResponse<EftTxn>> {
  return apiService.post<EftTxn>("/api/eft/transactions", body);
}

/** Long poll: answers once version ≥ minVersion, or the current state after the hold. */
export async function getEftTransaction(
  id: string,
  minVersion: number | null,
): Promise<ApiResponse<EftTxn>> {
  return apiService.get<EftTxn>(
    `/api/eft/transactions/${encodeURIComponent(id)}`,
    minVersion == null ? undefined : { min_version: String(minVersion) },
  );
}

export async function submitEftAction(
  id: string,
  body: { buttonKey: string; inputs: Record<string, string>; version: number },
): Promise<ApiResponse<EftTxn>> {
  return apiService.post<EftTxn>(`/api/eft/transactions/${encodeURIComponent(id)}/actions`, body);
}

export async function overrideEftTransaction(
  id: string,
  answer: "YES" | "NO",
): Promise<ApiResponse<EftTxn>> {
  return apiService.post<EftTxn>(`/api/eft/transactions/${encodeURIComponent(id)}/override`, { answer });
}

export async function cancelEftTransaction(id: string): Promise<ApiResponse<EftTxn>> {
  return apiService.post<EftTxn>(`/api/eft/transactions/${encodeURIComponent(id)}/cancel`);
}

export async function getEftLanes(): Promise<ApiResponse<EftLanes>> {
  return apiService.get<EftLanes>("/api/eft/lanes");
}

export async function getEftEvents(id: string): Promise<ApiResponse<EftEvent[]>> {
  return apiService.get<EftEvent[]>(`/api/eft/transactions/${encodeURIComponent(id)}/events`);
}

/** The lane API as the pure tender session (libs/eft/eft-flow.ts) uses it. */
export const eftLaneApi: EftLaneApi = {
  create: createEftTransaction,
  get: getEftTransaction,
  action: submitEftAction,
  override: overrideEftTransaction,
  cancel: cancelEftTransaction,
};

