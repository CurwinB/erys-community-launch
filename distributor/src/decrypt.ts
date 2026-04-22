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
  // The plaintext is the hex-encoded representation of the 64-byte Solana
  // secret key (see create-launch / create-launch-pumpfun edge functions which
  // call uint8ArrayToHex(secretKey) before encrypting). Decode that hex string
  // back into the raw 64 bytes that Keypair.fromSecretKey expects.
  const decryptedBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const hexString = decryptedBuf.toString("utf8");
  return Buffer.from(hexString, "hex");
}
