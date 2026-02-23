import { Router } from "express";
import express from "express";
import { printController } from "./printer.controller";

const router = Router();

router.post(
  "/print",
  express.raw({ type: "application/octet-stream", limit: "20mb" }),
  printController,
);

export default router;