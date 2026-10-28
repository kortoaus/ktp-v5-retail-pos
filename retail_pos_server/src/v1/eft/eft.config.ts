// Integrated EFTPOS configuration (retail-eftpos S-3 §8). Names only in docs;
// values come from retail_pos_server/.env. Switching the fake SCI for the real
// tenant = these values + re-pairing each lane. No code change.
//
//   EFT_SCI_PAIRING_API_URL        pairing API base (fake: http://127.0.0.1:7400)
//   EFT_SCI_PAIRING_API_KEY        pairing API key ("Authorization: ApiKey …")
//   EFT_SCI_SIGNING_SECRET_PART_A  signing secret part A (part B comes per pairing)
//   EFT_SECRET_KEY                 32-byte hex, encrypts part B at rest (AES-256-GCM)
//   EFT_SCI_POLL_DEADLINE_MS       no SCI progress for this long → TIMEOUT (60 000)
//   EFT_LANE_POLL_HOLD_MS          lane long-poll hold (20 000)
//   EFT_EVENT_RETENTION_DAYS       EftEvent prune age (180)
import dotenv from "dotenv";
dotenv.config();

export interface EftConfig {
  pairingApiUrl: string;
  pairingApiKey: string;
  signingSecretPartA: string;
  secretKeyHex: string;
  pollDeadlineMs: number;
  laneHoldMs: number;
  eventRetentionDays: number;
  /** After TIMEOUT / an override, keep watching SCI this long for a late result. */
  lateWatchMs: number;
  /** Backoff between SCI poll retries after an error. */
  retryBackoffMs: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadEftConfig(): EftConfig {
  return {
    pairingApiUrl: (process.env.EFT_SCI_PAIRING_API_URL || "").replace(/\/+$/, ""),
    pairingApiKey: process.env.EFT_SCI_PAIRING_API_KEY || "",
    signingSecretPartA: process.env.EFT_SCI_SIGNING_SECRET_PART_A || "",
    secretKeyHex: process.env.EFT_SECRET_KEY || "",
    pollDeadlineMs: intEnv("EFT_SCI_POLL_DEADLINE_MS", 60_000),
    laneHoldMs: intEnv("EFT_LANE_POLL_HOLD_MS", 20_000),
    eventRetentionDays: intEnv("EFT_EVENT_RETENTION_DAYS", 180),
    lateWatchMs: 5 * 60_000,
    retryBackoffMs: 1_000,
  };
}

/** What a new pairing needs. Existing pairings only need part A + the key. */
export function missingPairingConfig(cfg: EftConfig): string[] {
  const missing: string[] = [];
  if (!cfg.pairingApiUrl) missing.push("EFT_SCI_PAIRING_API_URL");
  if (!cfg.pairingApiKey) missing.push("EFT_SCI_PAIRING_API_KEY");
  if (!cfg.signingSecretPartA) missing.push("EFT_SCI_SIGNING_SECRET_PART_A");
  if (!/^[0-9a-fA-F]{64}$/.test(cfg.secretKeyHex)) missing.push("EFT_SECRET_KEY");
  return missing;
}

/** What signing a transaction call needs. */
export function missingSigningConfig(cfg: EftConfig): string[] {
  const missing: string[] = [];
  if (!cfg.signingSecretPartA) missing.push("EFT_SCI_SIGNING_SECRET_PART_A");
  if (!/^[0-9a-fA-F]{64}$/.test(cfg.secretKeyHex)) missing.push("EFT_SECRET_KEY");
  return missing;
}
