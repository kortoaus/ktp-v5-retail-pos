import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";

type StoreSettingDTO = {
  name: string;
  phone?: string;
  address1: string;
  address2?: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  abn?: string;
  website?: string;
  email?: string;
  credit_surcharge_rate?: number; // 1.5% default (0.015) handled elsewhere
  receipt_below_text?: string;
};

export const updateStoreSettingService = async (dto: StoreSettingDTO) => {
  try {
    const {
      name,
      phone,
      address1,
      address2,
      suburb,
      state,
      postcode,
      country,
      abn,
      website,
      email,
      credit_surcharge_rate,
      receipt_below_text,
    } = dto;

    const storeSetting = await db.storeSetting.update({
      where: { id: 1 },
      data: {
        name,
        phone,
        address1,
        address2,
        suburb,
        state,
        postcode,
        country,
        abn,
        website,
        email,
        credit_surcharge_rate,
        receipt_below_text,
      },
    });

    return {
      ok: true,
      result: storeSetting,
      msg: "Store setting updated successfully",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("updateStoreSettingService error:", e);
    throw new InternalServerException();
  }
};

export const getStoreSettingService = async () => {
  try {
    const storeSetting = await db.storeSetting.findUnique({
      where: { id: 1 },
    });
    if (!storeSetting) {
      throw new NotFoundException("Store setting not found");
    }
    return {
      ok: true,
      result: storeSetting,
      msg: "Store setting retrieved successfully",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getStoreSettingService error:", e);
    throw new InternalServerException();
  }
};
