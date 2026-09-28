import * as OTPAuth from "otpauth";
import { randomUUID } from "node:crypto";
import { AccountStatus, Role } from "@prisma/client";
import { prisma } from "../src/shared/prisma";
import { hashPassword } from "../src/modules/iam/password";
import { generateMfaSecret } from "../src/modules/iam/mfa.service";

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${randomUUID()}@test.local`;
}

export function computeTotp(base32Secret: string): string {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
  return totp.generate();
}

export interface TestAdmin {
  accountId: string;
  email: string;
  password: string;
  mfaSecret: string;
}

// Mirrors prisma/seed.ts but runs in-process against the shared test
// connection, rather than as a separate CLI invocation (see
// server/README.md on why separate processes don't mix with the PGlite
// test database).
export async function createTestAdmin(): Promise<TestAdmin> {
  const email = uniqueEmail("admin");
  const password = "AdminTestPassword1!";
  const mfaSecret = generateMfaSecret();
  const passwordHash = await hashPassword(password);

  const account = await prisma.$transaction(async (tx) => {
    const person = await tx.person.create({ data: {} });
    const account = await tx.account.create({
      data: {
        personId: person.id,
        email,
        passwordHash,
        status: AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        mfaSecret,
        mfaEnabledAt: new Date(),
      },
    });
    await tx.roleGrant.create({
      data: {
        accountId: account.id,
        role: Role.SYSTEM_ADMINISTRATOR,
        scopeType: "INSTITUTION",
        scopeId: null,
        grantedById: account.id,
        reason: "test bootstrap",
      },
    });
    return account;
  });

  return { accountId: account.id, email, password, mfaSecret };
}
