import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 256-bit URL-safe secret. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Lookup hash for secrets. Secrets are high-entropy, so a plain SHA-256 is appropriate. */
export function hashSecret(secret: string): string {
  return sha256Hex(`filesign:v1:${secret}`);
}

function key(): Buffer {
  return createHash("sha256").update(`filesign:enc:${env().APP_SECRET}`).digest();
}

/** AES-256-GCM, so admins can re-copy a pending link without storing it in plaintext. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, ct] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Pseudonymous IP for the audit log (keyed so it is not trivially reversible). */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return sha256Hex(`filesign:ip:${env().APP_SECRET}:${ip}`).slice(0, 16);
}
