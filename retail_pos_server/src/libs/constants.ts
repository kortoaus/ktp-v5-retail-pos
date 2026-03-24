import dotenv from "dotenv";
dotenv.config();

export const API_URL = process.env.API_URL || "";
export const ITEM_URL = process.env.ITEM_URL || "";
export const CRM_URL = process.env.CRM_URL || "";
export const API_KEY = process.env.API_KEY || "";

export const MONEY_SCALE = 100;
export const QTY_SCALE = 1000;
export const PCT_SCALE = 1000;

export const MONEY_DP = 2;
export const QTY_DP = 3;
export const PCT_DP = 3;
