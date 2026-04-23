import * as crypto from "crypto";

export function decryptEscrowKey(encryptedData: string): Buffer {
  const encryptionKeyHex = process.env.ESCROW_ENCRYPTION_KEY!;
  if (!encryptionKeyHex) throw new Error("ESCROW_ENCRYPTION_KEY not set");

  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format. Expected iv:authTag:ciphertext");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const key = Buffer.from(encryptionKeyHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  // Plaintext IS the raw 64-byte Solana secret key. The edge functions hex-encode
  // the key only as input to AES-GCM (which decodes it back to raw bytes before
  // encrypting), so the ciphertext plaintext is the raw 64 bytes — return as-is.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}