interface PrintEscposOptions {
  stripSerialInit?: boolean;
}

function stripLeadingInit(data: Uint8Array): Uint8Array {
  if (data.length >= 2 && data[0] === 0x1b && data[1] === 0x40) {
    return data.subarray(2);
  }

  return data;
}

export type PrintEscposResult = { ok: true } | { ok: false; message: string };

// 결과 반환판 — 알럿 없이 성공/실패만 돌려준다. 일괄 인쇄(packing slips)가
// 실패 시 중단 + 화면 알림을 하려면 결과가 필요하다 (트리아지 스펙 §6.5).
export async function printESCPOSResult(
  data: Uint8Array,
  options: PrintEscposOptions = {},
): Promise<PrintEscposResult> {
  const config = await window.electronAPI.getConfig();
  const printer = config.devices.escposPrinter;

  if (!printer) {
    return { ok: false, message: "ESC/POS printer not configured" };
  }

  if (printer.type === "serial") {
    const serialData = options.stripSerialInit ? stripLeadingInit(data) : data;
    const result = await window.electronAPI.printEscpos({
      printer,
      data: Array.from(serialData),
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  }

  if (!config.server) {
    return { ok: false, message: "Server not configured" };
  }

  const { host: serverHost, port: serverPort } = config.server;
  const { host: printerIp, port: printerPort } = printer;
  const terminalIp = await window.electronAPI.getNetworkIp();
  const url = `http://${serverHost}:${serverPort}/api/printer/print?ip=${printerIp}&port=${printerPort}`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (terminalIp) headers["ip-address"] = terminalIp;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: new Uint8Array(data) as unknown as BodyInit,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, message: body?.msg ?? `Print failed (${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Print failed: cannot reach server" };
  }
}

// 기존 호출부용 — 실패를 알럿으로 알리고 throw 하지 않는다 (인쇄가 판매를 막지 않게).
export async function printESCPOS(
  data: Uint8Array,
  options: PrintEscposOptions = {},
): Promise<void> {
  const result = await printESCPOSResult(data, options);
  if (!result.ok) window.alert(result.message);
}
