import axios from "axios";
import { CRM_URL } from "../../libs/constants";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
} from "../../libs/exceptions";
import { Company } from "../../generated/prisma/browser";

async function client(company: Company) {
  const client = await axios.get(`${CRM_URL}/api/post`, {
    headers: {
      contentType: "application/json",
      "ktpv5-company": JSON.stringify({
        // CRM 은 클라우드 회사 id 를 기대한다 — 로컬 Company.id(=1) 가 아니라 cloudId.
        id: company.cloudId,
        name: company.name,
      }),
    },
  });

  if (client.status !== 200 || !client.data.ok) {
    throw new BadRequestException("Failed to get cloud posts");
  }

  return client.data;
}

export async function getCloudPostsService(company: Company) {
  try {
    const result = await client(company);
    return result;
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error getting cloud posts:", e);
    throw new InternalServerException("Internal server error");
  }
}
