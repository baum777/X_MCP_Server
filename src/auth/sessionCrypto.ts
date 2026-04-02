import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "../lib/errors.js";

const ENCRYPTION_VERSION = "v1";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export function parseSessionEncryptionKey(rawKey: string): Buffer {
  const normalized = rawKey.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new AppError(
      "CONFIG_ERROR",
      "SESSION_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).",
      500,
      false
    );
  }
  const key = Buffer.from(normalized, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new AppError("CONFIG_ERROR", "SESSION_ENCRYPTION_KEY must decode to 32 bytes.", 500, false);
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer, aad?: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

export function decryptSecret(payload: string, key: Buffer, aad?: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new AppError("CRYPTO_ERROR", "Encrypted session payload has an invalid format.", 500, false);
  }

  const ivPart = parts[1];
  const tagPart = parts[2];
  const ciphertextPart = parts[3];
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new AppError("CRYPTO_ERROR", "Encrypted session payload has an invalid format.", 500, false);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    if (aad) {
      decipher.setAAD(Buffer.from(aad, "utf8"));
    }
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final()
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new AppError("CRYPTO_ERROR", "Encrypted session payload could not be decrypted.", 500, false);
  }
}

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
