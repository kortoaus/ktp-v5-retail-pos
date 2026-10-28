// Part B of the signing secret at rest: AES-256-GCM with EFT_SECRET_KEY
// (32-byte hex). Stored as one column "v1.<iv>.<tag>.<ciphertext>" (base64).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFrom(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("EFT_SECRET_KEY must be 32 bytes of hex");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(stored: string, keyHex: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || ct == null) throw new Error("unrecognised encrypted secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyHex), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
