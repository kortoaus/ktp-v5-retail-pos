/**
 * One holder at a time per serial path.
 *
 * Two things in this app open a label printer's serial port: `ipc/label.ts`,
 * which opens it fresh for every print job and closes it again in under a
 * second, and `ipc/zpl-font.ts`, which opens it for **minutes** to stream a
 * Korean font into flash. Those two must never overlap.
 *
 * The reason is not merely that the OS would refuse the second open. A printer
 * that has received a `~DY` header swallows every byte arriving on the port
 * until the declared count is satisfied — so a label sent during an install is
 * eaten by the font, the label never prints, and the font is corrupted by the
 * label's bytes. On a network printer that window is a few seconds; over serial
 * it is over ten minutes for all three weights. It has to fail fast and say
 * why, rather than produce a mystery.
 *
 * Deliberately dumb: an in-memory map in the main process. The main process is
 * the only thing in this app that opens serial ports, so there is nothing to
 * coordinate with. A second copy of the app running against the same COM port
 * is out of scope — the OS refuses that open anyway.
 *
 * Pure logic, no `serialport` import: covered by `serial-port-lock.test.mjs`.
 */

export interface SerialPortHolder {
  /**
   * Identity, compared by reference.
   *
   * Same object means the same holder, which is what makes a lease reentrant:
   * a font install takes the path for the whole run and then re-takes it once
   * per font as each connection opens.
   */
  readonly id: object;
  /** How this holder is named in the error the other side gets. */
  readonly description: string;
}

export function createSerialPortHolder(description: string): SerialPortHolder {
  return { id: {}, description };
}

export class SerialPortBusyError extends Error {
  readonly path: string;
  readonly heldBy: string;

  constructor(path: string, heldBy: string) {
    super(`${path} is in use by ${heldBy} — wait for it to finish, then try again`);
    this.name = "SerialPortBusyError";
    this.path = path;
    this.heldBy = heldBy;
  }
}

interface Entry {
  holder: SerialPortHolder;
  depth: number;
}

export class SerialPortLock {
  #held = new Map<string, Entry>();

  /**
   * Claim `path` for `holder`, or throw if somebody else has it.
   *
   * Returns a release function that is safe to call more than once — every
   * caller here releases in a `finally`, and a double release that decremented
   * twice would hand the port to a label job while a font was still streaming.
   */
  acquire(path: string, holder: SerialPortHolder): () => void {
    const current = this.#held.get(path);
    if (current && current.holder.id !== holder.id) {
      throw new SerialPortBusyError(path, current.holder.description);
    }

    if (current) current.depth += 1;
    else this.#held.set(path, { holder, depth: 1 });

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = this.#held.get(path);
      if (!entry || entry.holder.id !== holder.id) return;
      entry.depth -= 1;
      if (entry.depth <= 0) this.#held.delete(path);
    };
  }

  isBusy(path: string): boolean {
    return this.#held.has(path);
  }

  /** Who holds `path`, for a message; null when it is free. */
  heldBy(path: string): string | null {
    return this.#held.get(path)?.holder.description ?? null;
  }

  isHeldBy(path: string, holder: SerialPortHolder): boolean {
    return this.#held.get(path)?.holder.id === holder.id;
  }
}

/** The one lock the main process shares between label jobs and font installs. */
export const serialPortLock = new SerialPortLock();
