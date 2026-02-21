import { Company, Terminal, User } from "../../generated/prisma/client";
import db from "../../libs/db";
import { HttpException, InternalServerException } from "../../libs/exceptions";

type OnPaymentPayload = {
  subtotal: number; // Σ line.total
  documentDiscountAmount: number; // document-level discount applied
  creditSurchargeAmount: number; // 1.5% surcharge on credit payment
  rounding: number; // 5c rounding adjustment (+/-)
  total: number; // sale amount = subtotal - discount + rounding (excludes surcharge)
  taxAmount: number; // GST extracted (inclusive ÷ 11)
  cashPaid: number; // cash applied to bill (received - change)
  cashChange: number; // change given back to customer
  creditPaid: number; // base card charge (excludes surcharge)
  totalDiscountAmount: number; // line discounts + document discount ("You Saved")
};

export async function createSaleInvoiceService(
  company: Company,
  terminal: Terminal,
  user: User,
  shiftId: number,
  dto: OnPaymentPayload,
) {
  try {
    return { ok: true, msg: "success" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createSaleInvoiceService error:", e);
    throw new InternalServerException();
  }
}
