import { ipcMain } from "electron";
import net from "node:net";
import { SerialPort } from "serialport";
import iconv from "iconv-lite";
import type { LabelSendRequest, SLCSPart } from "../types";

const TCP_TIMEOUT_MS = 5000;
const SERIAL_TIMEOUT_MS = 3000;

function sendTcp(
  host: string,
  port: number,
  data: Buffer | string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(TCP_TIMEOUT_MS);

    socket.connect(port, host, () => {
      socket.write(data, () => {
        socket.end();
        resolve();
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`TCP timeout connecting to ${host}:${port}`));
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

function sendSerial(path: string, data: Buffer | string): Promise<void> {
  const dataSize = Buffer.isBuffer(data)
    ? data.length
    : Buffer.byteLength(data);
  console.log(`[Label:Serial] Opening ${path} (9600/8/N/1/XOFF)`);
  console.log(`[Label:Serial] Payload: ${dataSize} bytes`);

  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path,
      baudRate: 9600,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      xon: true,
      xoff: true,
      rtscts: false,
      autoOpen: false,
    });

    const timeout = setTimeout(() => {
      console.log(`[Label:Serial] Timeout on ${path}`);
      try {
        port.close();
      } catch {}
      reject(new Error(`Serial timeout on ${path}`));
    }, SERIAL_TIMEOUT_MS);

    port.open((err) => {
      if (err) {
        console.log(`[Label:Serial] Open failed: ${err.message}`);
        clearTimeout(timeout);
        reject(err);
        return;
      }

      console.log(`[Label:Serial] Port opened`);
      port.set({ dtr: true, rts: true });

      port.write(data, (writeErr) => {
        if (writeErr) {
          console.log(`[Label:Serial] Write failed: ${writeErr.message}`);
          clearTimeout(timeout);
          try {
            port.close();
          } catch {}
          reject(writeErr);
          return;
        }

        port.drain(() => {
          clearTimeout(timeout);
          port.close((closeErr) => {
            if (closeErr) {
              console.log(`[Label:Serial] Close error: ${closeErr.message}`);
            }
            console.log(
              `[Label:Serial] Done — ${dataSize} bytes sent, port closed`,
            );
            resolve();
          });
        });
      });
    });
  });
}

function assembleSLCS(parts: SLCSPart[]): Buffer {
  const buffers: Buffer[] = [];
  for (const part of parts) {
    if (part.type === "euc-kr") {
      buffers.push(iconv.encode(part.data, "euc-kr"));
    } else {
      buffers.push(Buffer.from(part.data, "ascii"));
    }
  }
  return Buffer.concat(buffers);
}

export function registerLabelHandlers(): void {
  ipcMain.handle("label:print", async (_event, request: LabelSendRequest) => {
    let data: Buffer | string;

    if (request.label.language === "zpl") {
      data = request.label.data;
    } else {
      data = assembleSLCS(request.label.parts);
    }

    try {
      if (request.printer.type === "net") {
        await sendTcp(request.printer.host!, request.printer.port!, data);
      } else {
        await sendSerial(request.printer.path!, data);
      }
      return { ok: true, message: "Printed" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { ok: false, message };
    }
  });
}
