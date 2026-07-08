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
  credit_surcharge_rate?: number; // permille (15 = 1.5%)
  receipt_below_text?: string;
  receipt_extra_footer_text?: string | null;
  user_daily_voucher_default?: number; // cents (2000 = $20)
  cash_point_rate?: number; // percent (1 = 10%)
  other_point_rate?: number; // percent (1 = 10%)
};

type StoreLabelSettingRow = {
  name: string;
  address1: string;
  address2: string | null;
  suburb: string;
  state: string;
  postcode: string;
};

type StoreLabelSettingClient = {
  storeSetting: {
    findUnique(args: {
      where: { id: number };
      select: {
        name: true;
        address1: true;
        address2: true;
        suburb: true;
        state: true;
        postcode: true;
      };
    }): Promise<StoreLabelSettingRow | null>;
  };
};

function compactAddressPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function formatStoreLabelAddress(
  storeSetting: Pick<
    StoreLabelSettingRow,
    "address1" | "address2" | "suburb" | "state" | "postcode"
  >,
): string {
  return [
    compactAddressPart(storeSetting.address1),
    compactAddressPart(storeSetting.address2),
    compactAddressPart(storeSetting.suburb),
    compactAddressPart(storeSetting.state),
    compactAddressPart(storeSetting.postcode),
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

export function createGetStoreLabelSettingService(
  client: StoreLabelSettingClient = db,
) {
  return async () => {
    try {
      const storeSetting = await client.storeSetting.findUnique({
        where: { id: 1 },
        select: {
          name: true,
          address1: true,
          address2: true,
          suburb: true,
          state: true,
          postcode: true,
        },
      });
      if (!storeSetting) {
        throw new NotFoundException("Store setting not found");
      }

      return {
        ok: true,
        result: {
          name: storeSetting.name,
          address: formatStoreLabelAddress(storeSetting),
        },
        msg: "Store label setting retrieved successfully",
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error("getStoreLabelSettingService error:", e);
      throw new InternalServerException();
    }
  };
}

export const getStoreLabelSettingService =
  createGetStoreLabelSettingService();

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
      receipt_extra_footer_text,
      user_daily_voucher_default,
      cash_point_rate,
      other_point_rate,
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
        receipt_extra_footer_text,
        user_daily_voucher_default,
        cash_point_rate,
        other_point_rate,
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
