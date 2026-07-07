import type { ApiResponse } from "../../libs/cloud.api";
import { crmApiService } from "../../libs/cloud.api";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
  UnauthorizedException,
} from "../../libs/exceptions";

export type PickupOrderMemberPhone = {
  memberId: string;
  phone: string;
  phoneLast4: string | null;
};

export type PickupOrderMemberPhoneDeps = {
  findOrderMemberId(
    crmOrderId: number,
  ): Promise<{ memberId: string } | null>;
  requestCrmPhone(
    memberId: string,
  ): Promise<ApiResponse<PickupOrderMemberPhone>>;
};

const defaultDeps: PickupOrderMemberPhoneDeps = {
  findOrderMemberId(crmOrderId) {
    return db.pickupOrderCache.findUnique({
      where: { crmOrderId },
      select: { memberId: true },
    });
  },
  requestCrmPhone(memberId) {
    return crmApiService.post<PickupOrderMemberPhone>("/device/member/phone", {
      memberId,
    });
  },
};

function requireCrmPhoneOk(
  res: ApiResponse<PickupOrderMemberPhone>,
): PickupOrderMemberPhone {
  if (res.ok && res.result != null) return res.result;
  if (res.ok && res.result == null) {
    throw new InternalServerException("CRM member phone service unavailable");
  }

  const msg = res.msg || res.message || "CRM member phone request failed";
  if (res.status === 400) {
    throw new BadRequestException(msg);
  }
  if (res.status === 404) {
    throw new NotFoundException(msg);
  }
  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedException(msg);
  }
  if (res.status === 0 || (res.status != null && res.status >= 500)) {
    throw new InternalServerException("CRM member phone service unavailable");
  }
  throw new HttpException(res.status ?? 502, msg);
}

export async function getPickupOrderMemberPhoneByCrmOrderId(
  crmOrderId: number,
  deps: PickupOrderMemberPhoneDeps = defaultDeps,
) {
  const order = await deps.findOrderMemberId(crmOrderId);
  if (!order) throw new NotFoundException("Pickup order not found");

  const result = requireCrmPhoneOk(await deps.requestCrmPhone(order.memberId));
  return {
    ok: true,
    msg: "Member phone loaded",
    result,
    paging: null,
  };
}
