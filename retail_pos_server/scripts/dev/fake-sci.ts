// bun run dev:fake-sci — fake SCI terminal server for development / demo
// (retail-eftpos D-3). No DB. Logic: src/dev/fake-sci.ts.
//
// env: EFT_FAKE_SCI_PORT (7400), EFT_FAKE_SCI_HOST (127.0.0.1),
//      EFT_SCI_SIGNING_SECRET_PART_A (must equal the store server's),
//      EFT_SCI_PAIRING_API_KEY (optional; when set the fake requires it),
//      FAKE_SCI_PUBLIC_URL, FAKE_SCI_STEP_MS (2000), FAKE_SCI_DEVICE_OFFLINE=1,
//      FAKE_SCI_REFUSE=1, FAKE_SCI_UNPAIR=1.
// Reads retail_pos_server/.env (bun loads it from the working directory).
import { startFakeSci } from "../../src/dev/fake-sci";

const partA = process.env.EFT_SCI_SIGNING_SECRET_PART_A || "";
if (!partA) {
  console.error("[fake-sci] EFT_SCI_SIGNING_SECRET_PART_A is empty — set the same value the store server uses (.env).");
  process.exit(1);
}

startFakeSci({
  port: Number(process.env.EFT_FAKE_SCI_PORT || 7400),
  host: process.env.EFT_FAKE_SCI_HOST || "127.0.0.1",
  partA,
  pairingApiKey: process.env.EFT_SCI_PAIRING_API_KEY || undefined,
  publicUrl: process.env.FAKE_SCI_PUBLIC_URL || undefined,
  stepMs: Number(process.env.FAKE_SCI_STEP_MS || 2000),
  mode: {
    deviceOffline: process.env.FAKE_SCI_DEVICE_OFFLINE === "1",
    refuse: process.env.FAKE_SCI_REFUSE === "1",
    unpaired: process.env.FAKE_SCI_UNPAIR === "1",
  },
}).then((fake) => {
  console.log(`[fake-sci] listening on ${fake.url} — pair with any 6-digit code; $1.00+ approves, $0.51 declines, x.77 asks for a signature, $0.68 never finalises`);
  const stop = () => fake.stop().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
