import axios from "axios";
import { CRM_URL } from "../../libs/constants";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
} from "../../libs/exceptions";
import type { Company } from "../../generated/prisma/browser";

/**
 * Store-screen post rule (D-P4-18, rule restaurant-pos/store-screen-posts-newest-five-not-ended):
 * the customer display rotates at most the newest five published posts, and drops any that
 * has ended or is archived — five fetched, two ended → rotate three. The restaurant kiosk
 * applies the same count and exclusions to its local copy.
 */
export const STORE_SCREEN_POST_LIMIT = 5;

/**
 * The fields of a CRM `/api/post` row this filter reads. api-server's public select sends
 * `status`, `eventStartAt`, `eventEndAt` (and already drops auto-archived posts);
 * `autoArchivedAt` / `archived` are checked too in case a row carries them.
 */
export type StoreScreenPostLike = {
  status?: string | null;
  archived?: boolean | null;
  autoArchivedAt?: string | Date | null;
  eventEndAt?: string | Date | null;
};

/**
 * `?limit=` from the till. Absent → 5 (older tills send none). A positive integer is capped
 * at 5; anything else is a 400.
 */
export function parseStoreScreenPostLimit(raw: unknown): number {
  if (raw === undefined || raw === "") return STORE_SCREEN_POST_LIMIT;
  const value = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException("Invalid limit");
  }
  return Math.min(value, STORE_SCREEN_POST_LIMIT);
}

function toTime(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** True when the post may be shown on a store screen at `now`. */
export function isStoreScreenPostLive(post: StoreScreenPostLike, now: Date): boolean {
  if (post.status !== "published") return false; // archived / draft
  if (post.archived === true) return false;
  const nowMs = now.getTime();
  const autoArchivedAt = toTime(post.autoArchivedAt);
  if (autoArchivedAt !== null && autoArchivedAt <= nowMs) return false;
  const eventEndAt = toTime(post.eventEndAt);
  if (eventEndAt !== null && eventEndAt < nowMs) return false;
  return true;
}

/**
 * Take the first `limit` rows in CRM's order (newest first), then drop ended/archived ones.
 * The cut happens before the filter on purpose: the owner's rule is "newest five, minus the
 * ended ones", not "first five live ones".
 */
export function selectStoreScreenPosts<T extends StoreScreenPostLike>(
  posts: readonly T[],
  limit: number,
  now: Date,
): T[] {
  return posts.slice(0, limit).filter((post) => isStoreScreenPostLive(post, now));
}

async function client(company: Company, limit: number) {
  const client = await axios.get(`${CRM_URL}/api/post`, {
    params: { limit },
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

export async function getCloudPostsService(
  company: Company,
  limit: number = STORE_SCREEN_POST_LIMIT,
  now: Date = new Date(),
) {
  try {
    const data = await client(company, limit);
    const rows: StoreScreenPostLike[] = Array.isArray(data.result) ? data.result : [];
    return { ...data, result: selectStoreScreenPosts(rows, limit, now) };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error getting cloud posts:", e);
    throw new InternalServerException("Internal server error");
  }
}
