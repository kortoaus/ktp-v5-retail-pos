// Fake SCI (Simple Cloud Integration) for development and the demo (retail-eftpos
// D-3, spec S-3 §7). In-memory, no DB, no credentials: it serves the Pairing API
// and the SCI API on one port and behaves like the Gecko Bank test terminal.
//
//   bun run dev:fake-sci          (scripts/dev/fake-sci.ts; port EFT_FAKE_SCI_PORT, default 7400)
//   store server .env: EFT_SCI_PAIRING_API_URL=http://127.0.0.1:7400
//
// It verifies the request signature with the same algorithm as the store
// server (secret = EFT_SCI_SIGNING_SECRET_PART_A it was started with + the
// part B it issued), so a demo proves signing, not just plumbing.
//
// Magic amounts (cents of purchase_amount): 1 refer to issuer, 5 do not honour,
// 6/94 duplicate, 51 insufficient funds, 54 expired card, 55 incorrect PIN,
// 68 response too late (never finalises → override demo), 91 issuer
// inoperative, other < 100 declined, ≥ 100 approved; any amount ending in .77
// → signature verification on the POS (AWAITING_POS + Approve/Decline).
// Pairing (T-9, F-20): only code 123456 pairs (confirmation 456456); any other
// 6-digit code answers 400 {error:"invalid_pairing_code"} so the invalid-code
// path can be shown. `anyCode` (env FAKE_SCI_ANY_CODE=1) restores "any 6-digit
// code pairs, confirmation = last 3 digits twice" for tests needing several pairings.
// Switches: ?fake=device_not_connected | refused | unknown on the create URL,
// env FAKE_SCI_DEVICE_OFFLINE=1 / FAKE_SCI_REFUSE=1 / FAKE_SCI_UNPAIR=1, or at
// runtime POST /_fake/mode {"deviceOffline":true,"refuse":false,"unpaired":false}.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { verifyRequest } from "../v1/eft/sci/sci.signing";

export interface FakeSciMode {
  deviceOffline: boolean;
  refuse: boolean;
  unpaired: boolean;
}

export interface FakeSciOptions {
  port?: number;
  host?: string;
  /** Signing secret part A shared with the store server. */
  partA: string;
  /** When set, progress-pairing requires "Authorization: ApiKey <this>". */
  pairingApiKey?: string;
  /** URL the store server reaches this fake at (default http://host:port). */
  publicUrl?: string;
  stepMs?: number;
  holdMs?: number;
  mode?: Partial<FakeSciMode>;
  /** Accept any 6-digit pairing code (default: env FAKE_SCI_ANY_CODE === "1"); otherwise only FAKE_SCI_PAIRING_CODE. */
  anyCode?: boolean;
  log?: (line: string) => void;
}

/** The one pairing code the fake accepts unless `anyCode` (T-9, F-20); confirmation 456456. */
export const FAKE_SCI_PAIRING_CODE = "123456";

type Outcome =
  | { kind: "approve" }
  | { kind: "decline"; message: string; code: string }
  | { kind: "never" }
  | { kind: "unknown" }
  | { kind: "signature" };

interface FakePairing {
  pairingId: string;
  keyId: string;
  partB: string;
  tid: string;
  pairingNickname: string | null;
  active: boolean;
}

interface FakeTxn {
  id: string;
  keyId: string;
  tid: string;
  version: number;
  status: "PENDING" | "AWAITING_POS" | "FINALISED";
  message: string;
  kind: "PURCHASE" | "REFUND";
  amount: number;
  surcharge: number;
  outcome: Outcome;
  financial: "APPROVED" | "DECLINED" | "CANCELLED" | "UNKNOWN" | null;
  merchantReceipt: string | null;
  customerReceipt: string | null;
  posInstructions: { auto_actions: string[]; action_form: unknown } | null;
  timers: NodeJS.Timeout[];
  waiters: Set<() => void>;
}

const DECLINES: Record<number, [string, string]> = {
  1: ["Refer to card issuer", "01"],
  5: ["Do not honour", "05"],
  6: ["Duplicate transaction", "06"],
  94: ["Duplicate transaction", "94"],
  51: ["Insufficient funds", "51"],
  54: ["Expired card", "54"],
  55: ["Incorrect PIN", "55"],
  91: ["Issuer inoperative", "91"],
};

export function outcomeForAmount(cents: number, fake?: string | null): Outcome {
  if (fake === "unknown") return { kind: "unknown" };
  if (cents % 100 === 77) return { kind: "signature" };
  if (cents >= 100) return { kind: "approve" };
  if (cents === 68) return { kind: "never" };
  const d = DECLINES[cents];
  return d ? { kind: "decline", message: d[0], code: d[1] } : { kind: "decline", message: "Declined", code: "05" };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function sydneyStamp(): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function line(left: string, right: string, width = 32): string {
  const pad = Math.max(1, width - left.length - right.length);
  return `${left}${" ".repeat(pad)}${right}`;
}

function receipt(t: FakeTxn, copy: "MERCHANT" | "CUSTOMER", result: string, extra: string[] = []): string {
  const rows = [
    "   GECKO BANK  (FAKE SCI)",
    "     KTP TEST MERCHANT",
    line(`TID ${t.tid}`, ""),
    sydneyStamp(),
    "",
    line(t.kind, money(t.amount)),
  ];
  if (t.surcharge > 0) rows.push(line("SURCHARGE", money(t.surcharge)), line("TOTAL", money(t.amount + t.surcharge)));
  rows.push("", "VISA CREDIT  ****4242", "CONTACTLESS", "", line(result, `REF ${t.id.slice(-6).toUpperCase()}`), ...extra, "", `     ${copy} COPY`);
  return rows.join("\n");
}

export async function startFakeSci(opts: FakeSciOptions) {
  const log = opts.log ?? ((l: string) => console.log(l));
  const stepMs = opts.stepMs ?? 2000;
  const holdMs = opts.holdMs ?? 10_000;
  const mode: FakeSciMode = { deviceOffline: false, refuse: false, unpaired: false, ...opts.mode };
  const anyCode = opts.anyCode ?? process.env.FAKE_SCI_ANY_CODE === "1";
  const pairings = new Map<string, FakePairing>();
  const txns = new Map<string, FakeTxn>();
  let baseUrl = "";

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    if (body === undefined) {
      res.writeHead(status).end();
      return;
    }
    const text = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json" }).end(text);
  };
  const err = (res: ServerResponse, status: number, code: string, message = code) => send(res, status, { error: { code, message } });

  const view = (t: FakeTxn) => ({
    data: {
      id: t.id,
      version: t.version,
      status: t.status,
      message: t.message,
      result_financial_status: t.status === "FINALISED" ? t.financial : null,
      result_amounts:
        t.status === "FINALISED"
          ? {
              purchase: t.kind === "PURCHASE" && t.financial === "APPROVED" ? t.amount : 0,
              surcharge: t.financial === "APPROVED" ? t.surcharge : 0,
              tip: 0,
              cashout: 0,
              refund: t.kind === "REFUND" && t.financial === "APPROVED" ? t.amount : 0,
              moto: 0,
            }
          : null,
      merchant_receipt: t.merchantReceipt,
      customer_receipt: t.customerReceipt,
      result_card_details:
        t.status === "FINALISED" ? { entry_mode: "CONTACTLESS", pan_first_6: "412345", pan_last_4: "4242", scheme_name: "VISA" } : null,
      pos_instructions: t.posInstructions ?? { auto_actions: [], action_form: null },
    },
  });

  const bump = (t: FakeTxn, patch: Partial<FakeTxn>) => {
    Object.assign(t, patch);
    t.version += 1;
    const ws = [...t.waiters];
    t.waiters.clear();
    for (const w of ws) w();
    log(`[fake-sci] txn=${t.id} v${t.version} ${t.status}${t.financial ? ` ${t.financial}` : ""} "${t.message}"`);
  };

  const finalise = (t: FakeTxn, financial: NonNullable<FakeTxn["financial"]>, message: string, extra: string[] = []) => {
    const result = financial === "APPROVED" ? "APPROVED" : financial === "UNKNOWN" ? "RESULT UNKNOWN" : `DECLINED`;
    bump(t, {
      status: "FINALISED",
      financial,
      message,
      merchantReceipt: receipt(t, "MERCHANT", result, extra),
      customerReceipt: receipt(t, "CUSTOMER", result, extra),
      posInstructions: { auto_actions: [], action_form: null },
    });
  };

  const schedule = (t: FakeTxn) => {
    t.timers.push(
      setTimeout(() => bump(t, { message: t.outcome.kind === "never" ? "Waiting for bank response" : "Processing" }), stepMs),
    );
    if (t.outcome.kind === "never") return;
    t.timers.push(
      setTimeout(() => {
        const o = t.outcome;
        if (o.kind === "approve") finalise(t, "APPROVED", "Approved");
        else if (o.kind === "decline") finalise(t, "DECLINED", o.message, [`RESPONSE ${o.code}  ${o.message.toUpperCase()}`]);
        else if (o.kind === "unknown") finalise(t, "UNKNOWN", "Result unknown");
        else if (o.kind === "signature") {
          const slip = receipt(t, "MERCHANT", "SIGNATURE REQUIRED", ["", "X______________________", "  CARDHOLDER SIGNATURE"]);
          bump(t, {
            status: "AWAITING_POS",
            message: "Verify signature",
            merchantReceipt: slip,
            posInstructions: {
              auto_actions: ["PRINT_MERCHANT_RECEIPT"],
              action_form: {
                layout: [{ horizontal_layout: [{ label: "Verify signature", key: "verify_text" }] }, { horizontal_layout: [{ key: "approve" }, { key: "decline" }] }],
                properties: {
                  verify_text: { type: "text", label: "Check the customer's signature against the card" },
                  approve: { type: "button", label: "Approve", submit_url: `${baseUrl}/v1/transactions/${t.id}?action=APPROVE_SIGNATURE` },
                  decline: { type: "button", label: "Decline", submit_url: `${baseUrl}/v1/transactions/${t.id}?action=DECLINE_SIGNATURE` },
                },
                details: { Amount: money(t.amount + t.surcharge), TID: t.tid },
              },
            },
          });
        }
      }, stepMs * 2),
    );
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", "http://fake");
    const method = req.method ?? "GET";
    const path = url.pathname;
    const origEnd = res.end.bind(res);
    // One log line per request (status + short body summary; never headers).
    let summary = "";
    res.end = ((...args: Parameters<ServerResponse["end"]>) => {
      log(`[fake-sci] ${method} ${path}${url.search} → ${res.statusCode}${summary ? ` ${summary}` : ""}`);
      return origEnd(...args);
    }) as ServerResponse["end"];

    try {
      // ── dev control ──
      if (path === "/_fake/mode" && method === "POST") {
        const patch = body ? (JSON.parse(body) as Partial<FakeSciMode>) : {};
        for (const k of ["deviceOffline", "refuse", "unpaired"] as const) if (typeof patch[k] === "boolean") mode[k] = patch[k] as boolean;
        summary = JSON.stringify(mode);
        return send(res, 200, { mode });
      }
      if (path === "/_fake/state" && method === "GET") {
        return send(res, 200, {
          mode,
          pairings: [...pairings.values()].map((p) => ({ pairingId: p.pairingId, tid: p.tid, active: p.active })),
          transactions: [...txns.values()].map((t) => ({ id: t.id, version: t.version, status: t.status, financial: t.financial, amount: t.amount })),
        });
      }

      // ── Pairing API (ApiKey, not signed) ──
      if (path === "/v1/progress-pairing" && method === "POST") {
        if (opts.pairingApiKey && req.headers.authorization !== `ApiKey ${opts.pairingApiKey}`) return err(res, 401, "invalid_api_key");
        const b = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        const code = String(b.pairing_code ?? "");
        if (!/^\d{6}$/.test(code)) return err(res, 400, "invalid_pairing_code", "pairing_code must be 6 digits");
        if (!anyCode && code !== FAKE_SCI_PAIRING_CODE) {
          summary = "pairing refused: invalid_pairing_code";
          return send(res, 400, { error: "invalid_pairing_code", message: "Invalid pairing code" });
        }
        const p: FakePairing = {
          pairingId: `pair_${randomBytes(6).toString("hex")}`,
          keyId: `key_${randomBytes(8).toString("hex")}`,
          partB: randomBytes(24).toString("hex"),
          tid: `T${code}`,
          pairingNickname: typeof b.pairing_nickname === "string" ? b.pairing_nickname : null,
          active: true,
        };
        pairings.set(p.keyId, p);
        const confirmation = code.slice(-3).repeat(2);
        summary = `pairing=${p.pairingId} confirmation=${confirmation}`;
        return send(res, 200, {
          pairing_id: p.pairingId,
          key_id: p.keyId,
          confirmation_code: confirmation,
          signing_secret_part_b: p.partB,
          sci_api_base_url: baseUrl,
          tid: p.tid,
          pairing_nickname: p.pairingNickname,
          terminal_nickname: "Gecko Bank (fake)",
        });
      }

      // ── SCI API (signed) ──
      if (!path.startsWith("/v1/")) return err(res, 404, "not_found");
      if (mode.unpaired) return err(res, 401, "no_active_pairings_found");
      const v = verifyRequest({
        method,
        authority: req.headers.host ?? "",
        requestTarget: req.url ?? "/",
        body: body || null,
        signatureInput: req.headers["signature-input"] as string | undefined,
        signature: req.headers.signature as string | undefined,
        contentDigestHeader: req.headers["content-digest"] as string | undefined,
        secretFor: (keyId) => {
          const p = pairings.get(keyId);
          return p ? opts.partA + p.partB : null;
        },
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      if (!v.ok) {
        summary = `signature ${v.reason}`;
        return err(res, 401, "no_valid_signatures_found");
      }
      const pairing = pairings.get(v.keyId)!;
      if (!pairing.active) return err(res, 401, "no_active_pairings_found");

      if (path === "/v1/pairing-info" && method === "GET") {
        return send(res, 200, { data: { pairing_id: pairing.pairingId, tid: pairing.tid, pairing_nickname: pairing.pairingNickname, terminal_nickname: "Gecko Bank (fake)" } });
      }
      if (path === "/v1/unpair" && method === "POST") {
        pairing.active = false;
        return send(res, 204);
      }
      if (path === "/v1/transactions" && method === "POST") {
        const fake = url.searchParams.get("fake");
        if (mode.deviceOffline || fake === "device_not_connected") return err(res, 424, "device_not_connected");
        if (mode.refuse || fake === "refused") return err(res, 409, "TRANSACTION_REFUSED");
        const b = body ? (JSON.parse(body) as Record<string, Record<string, unknown> | undefined>) : {};
        const purchase = b.purchase_details?.purchase_amount;
        const refund = b.refund_details?.refund_amount;
        const kind = Number.isInteger(purchase) ? "PURCHASE" : Number.isInteger(refund) ? "REFUND" : null;
        const amount = (kind === "PURCHASE" ? purchase : refund) as number;
        if (!kind || amount <= 0) return err(res, 400, "invalid_request", "purchase_details.purchase_amount or refund_details.refund_amount required");
        const surcharge = Number.isInteger(b.purchase_details?.surcharge_amount) ? (b.purchase_details!.surcharge_amount as number) : 0;
        const t: FakeTxn = {
          id: `txn_${randomBytes(8).toString("hex")}`,
          keyId: pairing.keyId,
          tid: pairing.tid,
          version: 1,
          status: "PENDING",
          message: "Present card",
          kind,
          amount,
          surcharge,
          outcome: kind === "REFUND" ? { kind: "approve" } : outcomeForAmount(amount, fake),
          financial: null,
          merchantReceipt: null,
          customerReceipt: null,
          posInstructions: null,
          timers: [],
          waiters: new Set(),
        };
        txns.set(t.id, t);
        schedule(t);
        summary = `txn=${t.id} ${kind} ${money(amount)} → ${t.outcome.kind}`;
        return send(res, 201, view(t));
      }
      const m = /^\/v1\/transactions\/([^/]+)$/.exec(path);
      if (m) {
        const t = txns.get(decodeURIComponent(m[1]));
        if (!t || t.keyId !== pairing.keyId) return err(res, 404, "transaction_not_found");
        if (method === "POST") {
          const action = url.searchParams.get("action");
          if (t.status !== "AWAITING_POS" || (action !== "APPROVE_SIGNATURE" && action !== "DECLINE_SIGNATURE"))
            return err(res, 409, "invalid_action");
          summary = `txn=${t.id} ${action}`;
          if (action === "APPROVE_SIGNATURE") finalise(t, "APPROVED", "Approved", ["SIGNATURE VERIFIED"]);
          else finalise(t, "DECLINED", "Signature declined", ["SIGNATURE DECLINED"]);
          return send(res, 200, view(t));
        }
        if (method === "GET") {
          const raw = url.searchParams.get("min_version");
          const min = raw == null ? null : Number(raw);
          if (min == null || t.version >= min) return send(res, 200, view(t));
          await new Promise<void>((resolve) => {
            const wake = () => {
              clearTimeout(timer);
              t.waiters.delete(wake);
              resolve();
            };
            const timer = setTimeout(wake, holdMs);
            t.waiters.add(wake);
            res.on("close", wake);
          });
          if (t.version >= (min as number)) return send(res, 200, view(t));
          return err(res, 404, "transaction_not_found_within_timeout");
        }
      }
      return err(res, 404, "not_found");
    } catch (e) {
      summary = e instanceof Error ? e.message : String(e);
      return err(res, 400, "invalid_request");
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 7400, opts.host ?? "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = (opts.publicUrl ?? `http://${opts.host ?? "127.0.0.1"}:${addr.port}`).replace(/\/+$/, "");

  return {
    url: baseUrl,
    port: addr.port,
    mode,
    transactions: txns,
    async stop() {
      for (const t of txns.values()) {
        t.timers.forEach(clearTimeout);
        for (const w of [...t.waiters]) w();
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
