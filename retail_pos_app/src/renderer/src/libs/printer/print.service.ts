interface PrintEscposOptions {
  stripSerialInit?: boolean;
}

function stripLeadingInit(data: Uint8Array): Uint8Array {
  if (data.length >= 2 && data[0] === 0x1b && data[1] === 0x40) {
    return data.subarray(2);
  }

  return data;
}

export async function printESCPOS(
  data: Uint8Array,
  options: PrintEscposOptions = {},
): Promise<void> {
  const config = await window.electronAPI.getConfig();
  const printer = config.devices.escposPrinter;

  if (!printer) {
    window.alert("ESC/POS printer not configured");
    return;
  }

  if (printer.type === "serial") {
    const serialData = options.stripSerialInit ? stripLeadingInit(data) : data;
    const result = await window.electronAPI.printEscpos({
      printer,
      data: Array.from(serialData),
    });
    if (!result.ok) {
      window.alert(result.message);
    }
    return;
  }

  if (!config.server) {
    window.alert("Server not configured");
    return;
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
      window.alert(body?.msg ?? `Print failed (${res.status})`);
    }
  } catch {
    window.alert("Print failed: cannot reach server");
  }
}
