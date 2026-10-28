// The keypad column while an integrated card payment runs (retail-eftpos T-7):
// live `displayMessage` from the store server, the Action Framework form when
// the terminal waits on the POS, the override question, Cancel on terminal.
// Nothing here is a hardcoded transaction screen. COMPLETE (with the keyed
// CREDIT draft) stays available in the Summary column — the cashier's manual
// escape hatch.
import ActionFormView from "../../../components/eft/ActionFormView";
import SciLogo from "../../../components/eft/SciLogo";
import { cn } from "../../../libs/cn";
import { eftPanelView, OVERRIDE_QUESTION } from "../../../libs/eft/eft-flow";
import { fmtMoney } from "../../../libs/sale/tender-queue";
import type { EftTender } from "./useEftTender";
import TapTarget from "./TapTarget";

export default function EftPanel({ eft, terminalLabel }: { eft: EftTender; terminalLabel: string }) {
  const v = eftPanelView(eft.state);
  const txn = eft.state.txn;
  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <SciLogo className="text-[10px] h-5" />
        <span className="truncate">{terminalLabel}</span>
        <span className="ml-auto font-mono font-bold text-gray-900 text-base">
          ${fmtMoney(txn?.amountCents ?? eft.state.requestCents)}
        </span>
      </div>

      <div className="rounded-md bg-zinc-900 text-white p-4 min-h-24 flex items-center justify-center text-center text-lg font-semibold">
        {v.message || "Waiting for terminal…"}
      </div>
      {v.notice && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {v.notice}
        </div>
      )}
      {eft.printNotice && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {eft.printNotice}
        </div>
      )}

      {v.actionForm && txn && (
        <div className="overflow-y-auto min-h-0">
          <ActionFormView
            key={txn.version}
            form={v.actionForm}
            version={txn.version}
            disabled={v.busy}
            onSubmit={eft.pressButton}
          />
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {v.cancelRequested && (
          <div className="text-xs text-gray-600">Cancel requested — cancel on the terminal.</div>
        )}
        {v.canCancel && (
          <TapTarget
            onClick={eft.requestCancel}
            disabled={v.busy}
            className={cn(
              "h-12 rounded-md border font-bold text-sm flex items-center justify-center",
              v.busy ? "bg-gray-100 text-gray-400 border-gray-200" : "bg-white text-red-600 border-red-300 active:bg-red-50",
            )}
          >
            Cancel on terminal
          </TapTarget>
        )}
      </div>

      {v.showOverride && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-6" style={{ zIndex: 9997 }}>
          <div className="bg-white rounded-xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="text-sm text-gray-600">{v.message}</div>
            <div className="text-2xl font-bold text-gray-900 text-center">{OVERRIDE_QUESTION}</div>
            <div className="text-xs text-gray-500 text-center">Check the terminal screen or its receipt before answering.</div>
            <div className="flex gap-3">
              <TapTarget
                onClick={() => eft.answerOverride("NO")}
                disabled={v.busy}
                className="flex-1 h-14 rounded-md bg-gray-200 text-gray-900 font-bold text-lg flex items-center justify-center active:bg-gray-300"
              >
                No
              </TapTarget>
              <TapTarget
                onClick={() => eft.answerOverride("YES")}
                disabled={v.busy}
                className="flex-1 h-14 rounded-md bg-emerald-600 text-white font-bold text-lg flex items-center justify-center active:bg-emerald-700"
              >
                Yes
              </TapTarget>
            </div>
            {v.notice && <div className="text-sm text-amber-700">{v.notice}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
