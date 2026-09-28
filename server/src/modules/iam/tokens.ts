import { createHash, randomBytes } from "node:crypto";

// Bearer tokens (session cookies, recovery/verification tokens) are
// generated as random opaque values. Only a SHA-256 hash of the raw value
// is ever persisted (SRS-004: "stored in non-recoverable form") so a
// database read alone can never be replayed as a valid credential.
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
