import { crmApiService } from "../../libs/cloud.api";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  UnauthorizedException,
} from "../../libs/exceptions";
import type { ApiResponse } from "../../libs/cloud.api";
import type {
  CrmPickupOrderWire,
  PickupOrderStatus,
  PickupOrderSyncPage,
} from "./pickup-order.types";

function requireOk<T>(res: {
  ok: boolean;
  msg?: string;
  status?: number;
  result?: T | null;
}): T {
  if (res.ok && res.result != null) return res.result;

  const msg = res.msg || "CRM pickup order request failed";
  if (res.status === 400 || res.status === 404) {
    throw new BadRequestException(msg);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedException(msg);
  }
  if (res.status === 0 || (res.status && res.status >= 500)) {
    throw new InternalServerException("CRM pickup order service unavailable");
  }
  throw new HttpException(res.status ?? 502, msg);
}

export async function fetchCrmPickupOrderSyncPage(input: {
  updatedAfter?: Date;
  afterId?: number;
  limit: number;
}): Promise<PickupOrderSyncPage> {
  const res = await crmApiService.get<PickupOrderSyncPage>(
    "/device/pickup-order/sync",
    {
      ...(input.updatedAfter
        ? { updatedAfter: input.updatedAfter.toISOString() }
        : {}),
      ...(input.afterId ? { afterId: input.afterId } : {}),
      limit: input.limit,
    },
  );

  return requireOk(res);
}

export type CrmPickupOrderStatusPayload = {
  status: Exclude<PickupOrderStatus, "CANCELLED_BY_CUSTOMER">;
  actorId?: string;
  actorName?: string;
  note?: string;
};

type CrmPickupOrderStatusClient = {
  post: (
    endpoint: string,
    payload: CrmPickupOrderStatusPayload,
  ) => Promise<ApiResponse<CrmPickupOrderWire>>;
};

export function createUpdateCrmPickupOrderStatus(
  client: CrmPickupOrderStatusClient,
) {
  return async (
    orderId: number,
    payload: CrmPickupOrderStatusPayload,
  ): Promise<CrmPickupOrderWire> => {
    const res = await client.post(
      `/device/pickup-order/${orderId}/status`,
      payload,
    );

    return requireOk(res);
  };
}

export async function updateCrmPickupOrderStatus(
  orderId: number,
  payload: CrmPickupOrderStatusPayload,
): Promise<CrmPickupOrderWire> {
  const res = await crmApiService.post<CrmPickupOrderWire>(
    `/device/pickup-order/${orderId}/status`,
    payload,
  );

  return requireOk(res);
}
