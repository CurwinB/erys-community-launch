import { randomBytes, createCipheriv } from "crypto";

/**
 * AES-256-GCM encryption matching the format used everywhere else in the
 * project (executor/decrypt.ts, create-launch-pumpfun encryptKey):
 *   "<iv hex>:<authTag hex>:<ciphertext hex>"
 * IV is 12 bytes, key is the 32-byte hex-encoded ESCROW_ENCRYPTION_KEY.
 */
export function encryptSecret(secretHex: string, encryptionKeyHex: string): string {
  const key = Buffer.from(encryptionKeyHex, "hex");
  if (key.length !== 32) {
    throw new Error(`ESCROW_ENCRYPTION_KEY must be 32 bytes hex (got ${key.length})`);
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.from(secretHex, "hex");
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}