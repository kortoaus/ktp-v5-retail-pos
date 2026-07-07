import apiService, { type ApiResponse } from "../libs/api";
import {
  normalizePickupOrderDetail,
  normalizePickupOrderListItem,
} from "../components/pickupOrders/pickup-order-format";
import type {
  PickupOrderDetail,
  PickupOrderDetailWire,
  PickupOrderListItem,
  PickupOrderListItemWire,
  PickupOrderListParams,
} from "../components/pickupOrders/pickup-order-types";

export type PickupOrderMemberPhone = {
  memberId: string;
  phone: string;
  phoneLast4: string | null;
};

export async function searchPickupOrders(
  params: PickupOrderListParams,
): Promise<ApiResponse<PickupOrderListItem[]>> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.status) qs.set("status", params.status);
  if (params.memberId) qs.set("memberId", params.memberId);

  const q = qs.toString();
  const res = await apiService.get<PickupOrderListItemWire[]>(
    q ? `/api/pickup-order?${q}` : "/api/pickup-order",
  );

  return {
    ...res,
    result: Array.isArray(res.result)
      ? res.result.map(normalizePickupOrderListItem)
      : null,
  };
}

export async function getPickupOrderByCrmId(
  crmOrderId: number,
): Promise<ApiResponse<PickupOrderDetail>> {
  const res = await apiService.get<PickupOrderDetailWire>(
    `/api/pickup-order/${crmOrderId}`,
  );

  return {
    ...res,
    result: res.result ? normalizePickupOrderDetail(res.result) : null,
  };
}

export async function getPickupOrderMemberPhone(
  crmOrderId: number,
): Promise<ApiResponse<PickupOrderMemberPhone>> {
  return apiService.get<PickupOrderMemberPhone>(
    `/api/pickup-order/${crmOrderId}/member-phone`,
  );
}
