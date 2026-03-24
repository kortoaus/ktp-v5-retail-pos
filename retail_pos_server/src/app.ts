import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import router from "./router";
import { HttpException } from "./libs/exceptions";
import terminalMiddleware from "./v1/terminal.middleware";
import db from "./libs/db";

const app = express();

app.use(express.json({ limit: "1mb" }));

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "ip-address"],
};

app.use(cors(corsOptions));

app.use((req: Request, _: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// app.get("/clear", async (_req: Request, res: Response) => {
//   await db.userVoucherHistory.deleteMany({}); // ← history 먼저
//   await db.userVoucher.deleteMany({});
//   await db.price.deleteMany({});
//   await db.promoPrice.deleteMany({});
//   await db.promotion.deleteMany({});
//   await db.saleInvoiceDiscount.deleteMany({});
//   await db.saleInvoiceRow.deleteMany({});
//   await db.saleInvoicePayment.deleteMany({});
//   await db.cashInOut.deleteMany({});
//   await db.saleInvoice.deleteMany({});
//   await db.terminalShift.deleteMany({});
//   res.status(200).json({ status: "ok" });
// });

app.get("/ok", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.get("/debug/invoice/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const invoice = await db.saleInvoice.findUnique({
    where: { id },
    include: { rows: true, payments: true, discounts: true, terminal: true },
  });
  if (!invoice) {
    res.status(404).json({ ok: false, msg: "Not found" });
    return;
  }
  res.status(200).json(invoice);
});

app.use(terminalMiddleware);
app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpException) {
    res.status(err.statusCode).json({ ok: false, msg: err.message });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, msg: "Internal server error" });
});

export default app;
