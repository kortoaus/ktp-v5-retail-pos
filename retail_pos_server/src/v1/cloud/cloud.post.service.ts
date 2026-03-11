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
      "ktpv5-company": JSON.stringify({ id: company.id, name: company.name }),
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
