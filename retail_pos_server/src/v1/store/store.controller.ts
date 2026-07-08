import {
  updateStoreSettingService,
  getStoreSettingService,
  getStoreLabelSettingService,
} from "./store.service";
import { Request, Response } from "express";

export const updateStoreSettingController = async (
  req: Request,
  res: Response,
) => {
  const result = await updateStoreSettingService(req.body);
  res.status(200).json(result);
};

export const getStoreSettingController = async (
  req: Request,
  res: Response,
) => {
  const result = await getStoreSettingService();
  res.status(200).json(result);
};

export const getStoreLabelSettingController = async (
  req: Request,
  res: Response,
) => {
  const result = await getStoreLabelSettingService();
  res.status(200).json(result);
};
