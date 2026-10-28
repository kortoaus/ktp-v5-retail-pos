// Cashier-facing text (A-9): English, short, with the error class in brackets
// so a cashier's "it doesn't work" comes with a code. Vendor names never
// appear here (certification: say "SCI", never the vendor).
import type { EftErrorClass } from "./provider";

export function cashierMessage(input: {
  status: string;
  financialStatus: string | null;
  message: string | null;
  errorClass: EftErrorClass | null;
  errorCode: string | null;
  overrideAnswer: string | null;
}): string {
  const { status, financialStatus, message, errorClass, errorCode } = input;
  if (status === "FINALISED_BY_OVERRIDE") return "Recorded as paid (manual confirmation)";
  if (status === "CANCELLED_BY_OVERRIDE") return "Recorded as not paid (manual confirmation)";
  if (status === "FINALISED" && financialStatus === "APPROVED") return message || "Approved";
  if (status === "FINALISED" && financialStatus === "UNKNOWN")
    return "Result unknown — check the terminal. Was it successful? [TIMEOUT]";
  if (status === "TIMEOUT") {
    if (errorCode === "CREATE_UNKNOWN")
      return `Lost contact while starting the payment — check the terminal. Was it successful? [${errorClass ?? "NET"}]`;
    if (errorClass && errorClass !== "TIMEOUT")
      return `Lost track of the payment — check the terminal. Was it successful? [${errorClass}]`;
    return "No answer from the terminal. Was it successful? [TIMEOUT]";
  }
  if (status === "FINALISED" && financialStatus === "CANCELLED") return `${message || "Transaction cancelled"} [BANK]`;
  if (status === "FINALISED" && financialStatus === "DECLINED") return `${message || "Card declined"} [BANK]`;
  if (status === "FAILED") {
    switch (errorClass) {
      case "NET":
        return "Could not reach payment service [NET]";
      case "PAIR":
        return errorCode === "no_valid_signatures_found"
          ? "Payment service rejected this lane's credentials — re-pair [PAIR]"
          : "Payment terminal is not paired — pair it in Settings [PAIR]";
      case "TERM":
        return errorCode === "TRANSACTION_REFUSED"
          ? "Terminal busy — finish or cancel on the terminal, then retry [TERM]"
          : "Terminal not connected — check its network and retry [TERM]";
      case "TIMEOUT":
        return "No answer from the terminal [TIMEOUT]";
      default:
        return "Payment state lost — check the terminal, then retry [POS]";
    }
  }
  return message || (status === "CREATING" ? "Sending to terminal…" : "Waiting for terminal…");
}
