import db from "../../libs/db";
import { HttpException, InternalServerException } from "../../libs/exceptions";
import {
  FreeTextTemplateInput,
  templateNameKey,
} from "./free-text-template.validate";

/** 최신 수정 우선. 동률이면 이름 오름차순 — 목록 순서가 흔들리지 않게. */
export async function getFreeTextTemplatesService() {
  try {
    const result = await db.freeTextTemplate.findMany({
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });
    return { ok: true, result };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error getting free text templates:", e);
    throw new InternalServerException("Internal server error");
  }
}

/**
 * 이름으로 덮어쓰기 저장.
 *
 * 판정은 **`lower(name)` 정확 일치**다. Prisma 의 `mode: "insensitive"` 는
 * Postgres 에서 `ILIKE` 로 내려가 `%`/`_` 가 와일드카드로 살아 있으므로
 * (이름에 `%` 하나만 있어도 남의 템플릿을 덮어쓴다) 여기서는 쓰지 않는다.
 * `name` 컬럼의 `@unique` 는 정확 일치라 이 케이스를 막아주지 못한다.
 *
 * 표시 이름은 마지막에 저장한 그대로(trim) 갱신된다 — "chilled" 로 다시
 * 저장하면 목록에도 "chilled" 로 보인다.
 */
export async function upsertFreeTextTemplateService(
  input: FreeTextTemplateInput,
) {
  const { name, lines } = input;

  try {
    const existing = await db.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "FreeTextTemplate"
      WHERE lower("name") = ${templateNameKey(name)}
      LIMIT 1
    `;

    if (existing.length > 0) {
      const result = await db.freeTextTemplate.update({
        where: { id: existing[0].id },
        data: { name, lines },
      });
      return { ok: true, result, msg: "Template saved" };
    }

    const result = await db.freeTextTemplate.create({
      data: { name, lines },
    });
    return { ok: true, result, msg: "Template saved" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error saving free text template:", e);
    throw new InternalServerException("Internal server error");
  }
}

/** 없는 id 는 무해한 성공 — 두 단말이 같은 템플릿을 동시에 지워도 뒤엣놈이
 *  에러를 보지 않는다(`deleteMany` 라 P2025 자체가 안 난다). */
export async function deleteFreeTextTemplateService(id: number) {
  try {
    const { count } = await db.freeTextTemplate.deleteMany({ where: { id } });
    return { ok: true, msg: count > 0 ? "Template deleted" : "Nothing to delete" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Error deleting free text template:", e);
    throw new InternalServerException("Internal server error");
  }
}
