import { kickDrawerPin2 } from "./escpos";
import { printESCPOS } from "./print.service";

export async function kickDrawer(): Promise<void> {
  await printESCPOS(kickDrawerPin2());
}