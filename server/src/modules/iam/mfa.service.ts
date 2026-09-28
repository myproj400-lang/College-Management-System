import * as OTPAuth from "otpauth";
import { env } from "../../config/env";
import type { Role } from "@prisma/client";

// SRS-005/SEC-01: multi-factor authentication for privileged roles.
// MFA_REQUIRED_ROLES is a deployment-configured list (see .env.example)
// rather than hard-coded, because which roles count as "privileged" is an
// institutional decision, not one this codebase should fix in advance.
export function roleRequiresMfa(role: Role): boolean {
  return env.MFA_REQUIRED_ROLES.includes(role);
}

export function generateMfaSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function buildEnrollmentUri(email: string, base32Secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: env.MFA_ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  return totp.toString();
}

// One step of clock drift tolerance in either direction.
export function verifyTotpCode(base32Secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
