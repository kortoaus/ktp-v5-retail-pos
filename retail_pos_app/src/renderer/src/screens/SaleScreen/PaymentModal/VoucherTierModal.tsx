// retail-delivery D-24 (T-17) — points→voucher exchange: pick one of the four
// tiers, then confirm twice. The exchange is sent (onIssue) only after the
// second confirmation; Cancel on either confirmation returns to the tier list.
// Review round 1: while the member has an unsettled exchange (answer lost) the
// dialog opens on "Finish previous exchange" instead — one Continue that
// resends it (onResume), no tier list and no affordability check.
// In-app dialogs only (no window.confirm). Touch: onPointerDown, like the rest
// of PaymentModal. Keyboard: Tab focuses rows and buttons (visible ring), Space
// activates, Escape goes back one step. Enter is deliberately NOT bound and
// Space inside a fast keystroke burst is ignored: the HID barcode scanner
// types fast and ends every scan with Enter.
// A confirm button arms ARM_MS after its step opens, so a double tap on a tier
// or on "Continue" cannot run through both confirmations.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../../libs/cn";
import {
  CUSTOMER_VOUCHER_TIERS,
  formatVoucherPoints,
  voucherExchangeStep,
  voucherIssueConfirmText,
  voucherResumeText,
  voucherTierRowLabel,
  voucherTierShortfall,
  voucherTierShortfallLabel,
  type CustomerVoucherTier,
  type PendingVoucherIssue,
  type VoucherConfirmText,
} from "../../../libs/customer-voucher-issue";

const ARM_MS = 400;
// Scanner keystrokes arrive < 50 ms apart (hooks/useBarcodeScanner.ts).
const BURST_MS = 60;

type Step =
  | { kind: "tiers" }
  | { kind: "resume"; pending: PendingVoucherIssue }
  | { kind: "confirm1"; tier: CustomerVoucherTier }
  | { kind: "confirm2"; tier: CustomerVoucherTier };

function initialStep(pending: PendingVoucherIssue | null): Step {
  return pending && voucherExchangeStep(pending).kind === "resume"
    ? { kind: "resume", pending }
    : { kind: "tiers" };
}

type Props = {
  open: boolean;
  memberPoints: number;
  issuing: boolean;
  // The member's unsettled exchange (service pendingCustomerVoucherIssue).
  pending: PendingVoucherIssue | null;
  onCancel: () => void;
  onIssue: (tier: CustomerVoucherTier) => void;
  onResume: () => void;
};

export default function VoucherTierModal({
  open,
  memberPoints,
  issuing,
  pending,
  onCancel,
  onIssue,
  onResume,
}: Props) {
  const [step, setStep] = useState<Step>(() => initialStep(pending));
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (open) setStep(initialStep(pending));
  }, [open, pending]);

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
      if (step.kind === "tiers" || step.kind === "resume") onCancel();
      else setStep({ kind: "tiers" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, issuing, step, onCancel]);

  if (!open) return null;

  const backToTiers = () => {
    if (!issuing) setStep({ kind: "tiers" });
  };

  let confirm: {
    text: VoucherConfirmText;
    tone: "blue" | "red";
    onCancel: () => void;
    onConfirm: () => void;
  } | null = null;
  if (step.kind === "resume") {
    confirm = {
      text: voucherResumeText(step.pending),
      tone: "blue",
      onCancel,
      onConfirm: onResume,
    };
  } else if (step.kind === "confirm1") {
    const tier = step.tier;
    confirm = {
      text: voucherIssueConfirmText(tier, memberPoints).first,
      tone: "blue",
      onCancel: backToTiers,
      onConfirm: () => setStep({ kind: "confirm2", tier }),
    };
  } else if (step.kind === "confirm2") {
    const tier = step.tier;
    confirm = {
      text: voucherIssueConfirmText(tier, memberPoints).second,
      tone: "red",
      onCancel: backToTiers,
      onConfirm: () => onIssue(tier),
    };
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-16 px-4"
      style={{ zIndex: 1100 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl">
        {confirm === null ? (
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
              <FocusTap
                onActivate={onCancel}
                className="w-12 h-12 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
              >
                ✕
              </FocusTap>
            </div>
            <div className="flex flex-col">
              {CUSTOMER_VOUCHER_TIERS.map((tier) => {
                const short = voucherTierShortfall(memberPoints, tier) > 0;
                return (
                  <FocusTap
                    key={tier.amount}
                    disabled={short}
                    onActivate={() => setStep({ kind: "confirm1", tier })}
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
                  </FocusTap>
                );
              })}
            </div>
            <div className="px-5 py-3">
              <FocusTap
                onActivate={onCancel}
                className="h-14 rounded-lg bg-gray-200 text-lg font-bold active:bg-gray-300 flex items-center justify-center"
              >
                Cancel
              </FocusTap>
            </div>
          </>
        ) : (
          <ConfirmStep
            key={step.kind}
            text={confirm.text}
            tone={confirm.tone}
            ready={armed && !issuing}
            busy={issuing}
            onCancel={() => {
              if (!issuing) confirm.onCancel();
            }}
            onConfirm={() => {
              if (!armed || issuing) return;
              confirm.onConfirm();
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
  busy,
  onCancel,
  onConfirm,
}: {
  text: VoucherConfirmText;
  tone: "blue" | "red";
  ready: boolean;
  busy: boolean;
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
        <FocusTap
          autoFocus
          disabled={busy}
          onActivate={onCancel}
          className={cn(
            "flex-1 h-14 rounded-lg text-lg font-bold flex items-center justify-center",
            busy ? "bg-gray-100 text-gray-400" : "bg-gray-200 active:bg-gray-300",
          )}
        >
          Cancel
        </FocusTap>
        <FocusTap
          disabled={!ready}
          onActivate={onConfirm}
          className={cn(
            "flex-1 h-14 rounded-lg text-white text-lg font-bold flex items-center justify-center",
            !ready
              ? "bg-gray-300"
              : tone === "red"
                ? "bg-red-600 active:bg-red-700"
                : "bg-blue-600 active:bg-blue-700",
          )}
        >
          {busy ? "Issuing..." : text.confirmLabel}
        </FocusTap>
      </div>
    </div>
  );
}

// A div tap target (PaymentModal keeps divs because of the scanner's Enter)
// that is also focusable: tabIndex 0 + visible focus ring; Space activates
// unless another key came within BURST_MS before it or arrives within
// BURST_MS after it (a scan, not a cashier).
function FocusTap({
  children,
  className,
  disabled,
  autoFocus,
  onActivate,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onActivate: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastKeyAt = useRef(0);
  const spaceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(
    () => () => {
      if (spaceTimer.current) clearTimeout(spaceTimer.current);
    },
    [],
  );

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onPointerDown={disabled ? undefined : () => onActivate()}
      onKeyDown={(e) => {
        const now = performance.now();
        const previous = lastKeyAt.current;
        lastKeyAt.current = now;
        if (spaceTimer.current) {
          clearTimeout(spaceTimer.current);
          spaceTimer.current = null;
        }
        if (e.key !== " ") return;
        e.preventDefault();
        if (e.repeat || disabled || now - previous < BURST_MS) return;
        spaceTimer.current = setTimeout(() => {
          spaceTimer.current = null;
          if (!disabledRef.current) activateRef.current();
        }, BURST_MS);
      }}
      className={cn(
        "select-none outline-none focus-visible:ring-4 focus-visible:ring-blue-400 focus-visible:ring-inset",
        className,
      )}
    >
      {children}
    </div>
  );
}
