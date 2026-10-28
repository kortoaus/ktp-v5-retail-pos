// One integrated card payment at a time for the PaymentModal (retail-eftpos
// T-7): owns the pure session (libs/eft/eft-flow.ts createEftSession) over the
// lane API, prints the terminal receipts through the existing receipt printer
// path, and reports the final outcome once. Unmount = stop polling (the store
// server keeps driving the terminal; the same sale attempt resumes the row).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEftSession,
  initialEftFlow,
  type EftFlowState,
  type EftOutcome,
  type EftSession,
  type ReceiptJob,
} from "../../../libs/eft/eft-flow";
import { buildEftReceiptBytes } from "../../../libs/eft/eft-receipt";
import { printESCPOSResult } from "../../../libs/printer/print.service";
import { eftLaneApi } from "../../../service/eft.service";

export type EftResultLine = { tone: "ok" | "error"; text: string } | null;

export function useEftTender(onOutcome: (outcome: EftOutcome, state: EftFlowState) => void) {
  const [state, setState] = useState<EftFlowState>(initialEftFlow);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const sessionRef = useRef<EftSession | null>(null);
  const outcomeRef = useRef(onOutcome);
  outcomeRef.current = onOutcome;

  useEffect(() => () => sessionRef.current?.stop(), []);

  // Printing never blocks the payment: a failure is a line under the status.
  const print = useCallback(async (job: ReceiptJob) => {
    try {
      const res = await printESCPOSResult(buildEftReceiptBytes(job.text));
      setPrintNotice(res.ok ? null : `${job.which === "merchant" ? "Merchant" : "Customer"} receipt not printed: ${res.message}`);
    } catch (e) {
      setPrintNotice(`Receipt not printed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const start = useCallback(
    (input: { operationId: string; amountCents: number; appliedTxnIds: string[] }) => {
      sessionRef.current?.stop();
      setPrintNotice(null);
      let reported = false;
      const session = createEftSession({
        api: eftLaneApi,
        print,
        onState: (next) => {
          setState(next);
          if (!reported && next.phase === "done" && next.outcome) {
            reported = true;
            outcomeRef.current(next.outcome, next);
          }
        },
      });
      sessionRef.current = session;
      void session.start(input);
    },
    [print],
  );

  /** Back to the pay panel (after an outcome). Receipts already queued still print. */
  const close = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setState(initialEftFlow());
  }, []);

  return {
    state,
    printNotice,
    start,
    close,
    pressButton: (body: { buttonKey: string; inputs: Record<string, string>; version: number }) =>
      void sessionRef.current?.pressButton(body),
    answerOverride: (answer: "YES" | "NO") => void sessionRef.current?.answerOverride(answer),
    requestCancel: () => void sessionRef.current?.requestCancel(),
    /** A payment is running on the terminal (create sent, not final). */
    running: state.phase === "starting" || state.phase === "live",
  };
}

export type EftTender = ReturnType<typeof useEftTender>;
