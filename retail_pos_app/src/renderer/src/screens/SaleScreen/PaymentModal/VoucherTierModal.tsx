// retail-delivery D-24 (T-17) — points→voucher exchange: pick one of the four
// tiers, then confirm twice. The exchange is sent (onIssue) only after the
// second confirmation; Cancel on either confirmation returns to the tier list.
// In-app dialogs only (no window.confirm). Touch first (onPointerDown, like
// the rest of PaymentModal); Escape goes back one step. Enter is deliberately
// NOT bound: the HID barcode scanner ends every scan with Enter.
// A confirm button arms ARM_MS after its step opens, so a double tap on a tier
// or on "Continue" cannot run through both confirmations.

import { useEffect, useState } from "react";
import { cn } from "../../../libs/cn";
import {
  CUSTOMER_VOUCHER_TIERS,
  formatVoucherPoints,
  voucherIssueConfirmText,
  voucherTierRowLabel,
  voucherTierShortfall,
  voucherTierShortfallLabel,
  type CustomerVoucherTier,
  type VoucherConfirmText,
} from "../../../libs/customer-voucher-issue";
import TapTarget from "./TapTarget";

const ARM_MS = 400;

type Step =
  | { kind: "tiers" }
  | { kind: "confirm1"; tier: CustomerVoucherTier }
  | { kind: "confirm2"; tier: CustomerVoucherTier };

type Props = {
  open: boolean;
  memberPoints: number;
  issuing: boolean;
  onCancel: () => void;
  onIssue: (tier: CustomerVoucherTier) => void;
};

export default function VoucherTierModal({
  open,
  memberPoints,
  issuing,
  onCancel,
  onIssue,
}: Props) {
  const [step, setStep] = useState<Step>({ kind: "tiers" });
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (open) setStep({ kind: "tiers" });
  }, [open]);

  useEffect(() => {
    setArmed(false);
    if (step.kind === "tiers") return;
    const timer = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || issuing) return;
      if (step.kind === "tiers") onCancel();
      else setStep({ kind: "tiers" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, issuing, step, onCancel]);

  if (!open) return null;

  const backToTiers = () => {
    if (!issuing) setStep({ kind: "tiers" });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-16 px-4"
      style={{ zIndex: 1100 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl">
        {step.kind === "tiers" ? (
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-bold">Exchange Points for a Voucher</h2>
                <div className="text-sm text-gray-500">
                  Member balance:{" "}
                  <span className="font-mono font-bold text-gray-900">
                    {formatVoucherPoints(memberPoints)}
                  </span>
                </div>
              </div>
              <TapTarget
                onPointerDown={onCancel}
                className="w-12 h-12 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
              >
                ✕
              </TapTarget>
            </div>
            <div className="flex flex-col">
              {CUSTOMER_VOUCHER_TIERS.map((tier) => {
                const short = voucherTierShortfall(memberPoints, tier) > 0;
                return (
                  <TapTarget
                    key={tier.amount}
                    disabled={short}
                    onPointerDown={() => setStep({ kind: "confirm1", tier })}
                    className={cn(
                      "h-20 px-5 border-b border-gray-100 flex items-center justify-between gap-4",
                      short
                        ? "bg-gray-50 text-gray-400 cursor-not-allowed"
                        : "active:bg-blue-50",
                    )}
                  >
                    <span className="text-2xl font-bold font-mono">
                      {voucherTierRowLabel(tier)}
                    </span>
                    {short ? (
                      <span className="text-sm font-semibold text-red-500">
                        {voucherTierShortfallLabel(memberPoints, tier)}
                      </span>
                    ) : (
                      <span className="min-w-[120px] h-12 px-4 rounded-lg font-bold text-sm bg-blue-600 text-white flex items-center justify-center">
                        Select
                      </span>
                    )}
                  </TapTarget>
                );
              })}
            </div>
            <div className="px-5 py-3">
              <TapTarget
                onPointerDown={onCancel}
                className="h-14 rounded-lg bg-gray-200 text-lg font-bold active:bg-gray-300 flex items-center justify-center"
              >
                Cancel
              </TapTarget>
            </div>
          </>
        ) : (
          <ConfirmStep
            text={
              step.kind === "confirm1"
                ? voucherIssueConfirmText(step.tier, memberPoints).first
                : voucherIssueConfirmText(step.tier, memberPoints).second
            }
            tone={step.kind === "confirm1" ? "blue" : "red"}
            ready={armed && !issuing}
            busyLabel={step.kind === "confirm2" && issuing ? "Issuing..." : null}
            onCancel={backToTiers}
            onConfirm={() => {
              if (!armed || issuing) return;
              if (step.kind === "confirm1") setStep({ kind: "confirm2", tier: step.tier });
              else onIssue(step.tier);
            }}
          />
        )}
      </div>
    </div>
  );
}

function ConfirmStep({
  text,
  tone,
  ready,
  busyLabel,
  onCancel,
  onConfirm,
}: {
  text: VoucherConfirmText;
  tone: "blue" | "red";
  ready: boolean;
  busyLabel: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="p-6">
      <div className="text-2xl font-bold">{text.title}</div>
      <div className="mt-3 space-y-1">
        {text.lines.map((line, i) => (
          <div
            key={line}
            className={i === 0 ? "text-lg font-semibold" : "text-base text-gray-600"}
          >
            {line}
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-3">
        <TapTarget
          disabled={busyLabel !== null}
          onPointerDown={onCancel}
          className={cn(
            "flex-1 h-14 rounded-lg text-lg font-bold flex items-center justify-center",
            busyLabel !== null
              ? "bg-gray-100 text-gray-400"
              : "bg-gray-200 active:bg-gray-300",
          )}
        >
          Cancel
        </TapTarget>
        <TapTarget
          disabled={!ready}
          onPointerDown={onConfirm}
          className={cn(
            "flex-1 h-14 rounded-lg text-white text-lg font-bold flex items-center justify-center",
            !ready
              ? "bg-gray-300"
              : tone === "red"
                ? "bg-red-600 active:bg-red-700"
                : "bg-blue-600 active:bg-blue-700",
          )}
        >
          {busyLabel ?? text.confirmLabel}
        </TapTarget>
      </div>
    </div>
  );
}
