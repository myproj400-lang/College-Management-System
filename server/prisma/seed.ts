/**
 * Local/test bootstrap data only. Creates one SYSTEM_ADMINISTRATOR account
 * so there is a way to grant further roles through the API instead of a
 * database edit. Every value here is clearly fictional/dev-only - this is
 * NOT a production account provisioning mechanism (Master Prompt §3: use
 * labelled sample data only, never fabricate production configuration).
 */
import { AccountStatus, PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../src/modules/iam/password";
import { generateMfaSecret } from "../src/modules/iam/mfa.service";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the seed script against NODE_ENV=production.");
  }

  const email = "admin@icms.local.test";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("Set SEED_ADMIN_PASSWORD in your .env before seeding (local dev value only).");
  }

  const existing = await prisma.account.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed admin account already exists: ${email}`);
    return;
  }

  const passwordHash = await hashPassword(password);
  // SYSTEM_ADMINISTRATOR is an MFA-required role (see .env MFA_REQUIRED_ROLES),
  // so the seed account must already be enrolled before the grant exists -
  // same precondition roleGrant.service.grantRole enforces for everyone else.
  const mfaSecret = generateMfaSecret();

  const result = await prisma.$transaction(async (tx) => {
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
    const grant = await tx.roleGrant.create({
      data: {
        accountId: account.id,
        role: Role.SYSTEM_ADMINISTRATOR,
        scopeType: "INSTITUTION",
        scopeId: null,
        grantedById: account.id, // bootstrap: the seed account grants itself the first grant
        reason: "Initial bootstrap administrator (seed script)",
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: null,
        action: "seed.bootstrap_admin",
        objectType: "Account",
        objectId: account.id,
        correlationId: "seed-script",
      },
    });
    return { account, grant, mfaSecret };
  });

  console.log("Seed administrator created:");
  console.log(`  email:    ${email}`);
  console.log(`  password: (the SEED_ADMIN_PASSWORD you set in .env)`);
  console.log(`  MFA secret (base32, add to an authenticator app): ${result.mfaSecret}`);
  console.log("  This account requires MFA on login (SYSTEM_ADMINISTRATOR is in MFA_REQUIRED_ROLES).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
