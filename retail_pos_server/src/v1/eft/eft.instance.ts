// Process-wide EFT engine: Prisma store + SCI provider from env (eft.config.ts).
import { loadEftConfig } from "./eft.config";
import { EftEngine } from "./eft.engine";
import { prismaEftStore } from "./eft.store.prisma";
import type { EftProvider } from "./provider";
import { SciProvider } from "./sci/sci.provider";

let engine: EftEngine | null = null;

export function getEftEngine(): EftEngine {
  if (!engine) {
    const config = loadEftConfig();
    const sci = new SciProvider({
      pairingApiUrl: config.pairingApiUrl,
      pairingApiKey: config.pairingApiKey,
      signingSecretPartA: config.signingSecretPartA,
    });
    const providers: Record<string, EftProvider> = { sci };
    engine = new EftEngine({
      store: prismaEftStore,
      config,
      providerFor: (id) => {
        const p = providers[id];
        if (!p) throw new Error(`EFT provider ${id} is not available`);
        return p;
      },
    });
  }
  return engine;
}

/** Boot: restart the poll loop of every open transaction (S-3 §4). */
export function startEftRecovery(): void {
  getEftEngine()
    .recover()
    .catch((err) => console.error(`[eft] recovery failed: ${err instanceof Error ? err.message : err}`));
}
