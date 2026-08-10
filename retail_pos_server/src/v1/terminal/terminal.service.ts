import db from "../../libs/db";
import { NotFoundException } from "../../libs/exceptions";

// 주문 차임 설정용 터미널 목록 — StoreSettingScreen 의 토글 UI 가 소비.
export async function listTerminalsService() {
  const terminals = await db.terminal.findMany({
    where: { archived: false },
    select: { id: true, name: true, orderChimeEnabled: true },
    orderBy: { id: "asc" },
  });
  return { ok: true, result: terminals };
}

export async function setTerminalOrderChimeService(id: number, enabled: boolean) {
  const terminal = await db.terminal.findFirst({
    where: { id, archived: false },
  });
  if (!terminal) throw new NotFoundException("Terminal not found");

  const updated = await db.terminal.update({
    where: { id },
    data: { orderChimeEnabled: enabled },
    select: { id: true, name: true, orderChimeEnabled: true },
  });
  return { ok: true, result: updated };
}
