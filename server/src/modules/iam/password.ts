import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

// SRS-005/SEC-01: adaptive password hashing with unique salts. Argon2id is
// the OWASP-recommended default; @node-rs/argon2 ships prebuilt native
// bindings so this doesn't require a local C++ toolchain to install.
const ARGON2_OPTIONS = {
  memoryCost: 19456, // ~19 MB, OWASP minimum recommendation for argon2id
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = randomBytes(16);
  return hash(plainPassword, { ...ARGON2_OPTIONS, salt });
}

export async function verifyPassword(hash_: string, plainPassword: string): Promise<boolean> {
  try {
    return await verify(hash_, plainPassword);
  } catch {
    // Malformed/foreign hash - treat as non-match rather than throwing,
    // so callers have one code path for "wrong password".
    return false;
  }
}

const MIN_PASSWORD_LENGTH = 10;

export function isPasswordAcceptable(plainPassword: string): boolean {
  // Minimum length only at this phase. Composition rules, breach-list
  // checks etc. are a security-owner policy decision (SRS §5 implementation
  // boundary) - not invented here.
  return plainPassword.length >= MIN_PASSWORD_LENGTH;
}
