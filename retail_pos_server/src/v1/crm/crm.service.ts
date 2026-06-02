import { crmApiService } from "../../libs/cloud.api";
import { HttpException, InternalServerException } from "../../libs/exceptions";

export async function createMemberService(data: any) {
  try {
    const result = await crmApiService.post("/device/member/create", data);
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error creating member:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function stageMemberSignupService(data: any) {
  try {
    const result = await crmApiService.post("/device/member/signup/stage", data);
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error staging member signup:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function requestMemberSignupOtpService(data: { phone: string }) {
  try {
    const result = await crmApiService.post(
      "/device/member/signup/request-otp",
      data,
    );
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error requesting member signup OTP:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function verifyMemberSignupService(data: {
  phone: string;
  code: string;
}) {
  try {
    const result = await crmApiService.post("/device/member/signup/verify", data);
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error verifying member signup:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function searchMemberService(data: any) {
  try {
    const result = await crmApiService.post(
      "/device/member/search/phone",
      data,
    );
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching member:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function searchMembersByKeywordService(data: {
  keyword: string;
}) {
  try {
    const result = await crmApiService.post(
      "/device/member/search/keyword",
      data,
    );
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching members:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function searchMemberByIdService(data: any) {
  try {
    const result = await crmApiService.post("/device/member/search/id", data);
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching member:", e);
    throw new InternalServerException("Internal server error");
  }
}
