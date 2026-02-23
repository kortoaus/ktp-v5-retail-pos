import net from "net";

const CONNECT_TIMEOUT = 5_000;
const JOB_TIMEOUT = 10_000;
const CHUNK_SIZE = 32 * 1024;

const queues = new Map<string, Promise<void>>();

function enqueue(ip: string, job: () => Promise<void>): Promise<void> {
  const prev = queues.get(ip) ?? Promise.resolve();
  const next = prev.then(job, () => job());
  queues.set(ip, next);
  next.finally(() => {
    if (queues.get(ip) === next) queues.delete(ip);
  });
  return next;
}

function connectPrinter(ip: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(CONNECT_TIMEOUT);
    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Printer connect timeout: ${ip}:${port}`));
    });
    socket.once("error", (err) => {
      reject(new Error(`Printer connect error: ${err.message}`));
    });
    socket.connect(port, ip);
  });
}

async function writeAll(socket: net.Socket, data: Buffer): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const chunk = data.subarray(offset, offset + CHUNK_SIZE);
    offset += CHUNK_SIZE;
    const ok = socket.write(chunk);
    if (!ok) {
      await new Promise<void>((resolve, reject) => {
        socket.once("drain", resolve);
        socket.once("error", reject);
      });
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function printToDevice(
  ip: string,
  port: number,
  data: Buffer,
): Promise<{ bytes: number }> {
  return enqueue(ip, async () => {
    await withTimeout(
      (async () => {
        const socket = await connectPrinter(ip, port);
        try {
          await writeAll(socket, data);
        } finally {
          socket.end();
        }
      })(),
      JOB_TIMEOUT,
      `Print job timeout: ${ip}:${port}`,
    );
  }).then(() => ({ bytes: data.length }));
}