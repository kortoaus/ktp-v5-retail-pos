import { crmApiService } from "../../libs/cloud.api";
import { HttpException, InternalServerException } from "../../libs/exceptions";

export async function createMemberService(data: any) {
  try {
    const result = await crmApiService.post("/member/create", data);
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error creating member:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function searchMemberService(data: any) {
  try {
    const result = await crmApiService.post("/member/search", data);
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error searching member:", e);
    throw new InternalServerException("Internal server error");
  }
}
