export async function printESCPOS(data: Uint8Array): Promise<void> {
  const config = await window.electronAPI.getConfig();
  if (!config.server) {
    window.alert("Server not configured");
    return;
  }
  if (!config.devices.escposPrinter) {
    window.alert("ESC/POS printer not configured");
    return;
  }
  const { host: serverHost, port: serverPort } = config.server;
  const { host: printerIp, port: printerPort } = config.devices.escposPrinter;
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
