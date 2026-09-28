import { AccountStatus, RecoveryPurpose } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import { AppError, AuthenticationError, ValidationError } from "../../shared/errors";
import { writeAuditEvent } from "../../shared/audit";
import { notificationPort } from "../../shared/notification";
import { hashPassword, isPasswordAcceptable, verifyPassword } from "./password";
import { createRecoveryToken, consumeRecoveryToken } from "./recovery.service";
import { createSession, resolveSession, revokeAllSessionsForAccount, revokeSession } from "./session.service";
import { verifyTotpCode } from "./mfa.service";

const FAILED_LOGIN_LOCK_THRESHOLD = 5;
const FAILED_LOGIN_LOCK_MINUTES = 15;
const MFA_PENDING_SESSION_MINUTES = 5;

export interface RequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
  correlationId: string;
}

// SRS-005: never reveal whether a given email is registered. register()
// always succeeds from the caller's point of view even if the email is
// already taken - it just doesn't create a second account or resend a
// token in a way that discloses the conflict.
export async function register(email: string, password: string, meta: RequestMeta): Promise<void> {
  if (!isPasswordAcceptable(password)) {
    throw new ValidationError("Password does not meet the minimum requirements.", {
      password: "Must be at least 10 characters.",
    });
  }

  const existing = await prisma.account.findUnique({ where: { email } });
  if (existing) {
    // Do not create a second account and do not disclose the conflict.
    // A real deployment would still email the existing owner a notice here
    // once a provider is selected; the notification boundary is a known gap
    // (see shared/notification.ts).
    return;
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const person = await tx.person.create({ data: {} });
    const account = await tx.account.create({
      data: { personId: person.id, email, passwordHash, status: AccountStatus.INVITED },
    });
    const rawToken = await createRecoveryToken(tx, account.id, RecoveryPurpose.EMAIL_VERIFICATION);
    await writeAuditEvent(tx, {
      actorId: null,
      action: "account.register",
      objectType: "Account",
      objectId: account.id,
      correlationId: meta.correlationId,
    });
    await notificationPort.send({
      to: email,
      template: "email-verification",
      data: { token: rawToken },
    });
  });
}

export async function verifyEmail(rawToken: string, meta: RequestMeta): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const consumed = await consumeRecoveryToken(tx, rawToken, RecoveryPurpose.EMAIL_VERIFICATION);
    if (!consumed) {
      throw new AppError(400, "INVALID_TOKEN", "This verification link is invalid or has expired.");
    }
    await tx.account.update({
      where: { id: consumed.accountId },
      data: { status: AccountStatus.ACTIVE, emailVerifiedAt: new Date() },
    });
    await writeAuditEvent(tx, {
      actorId: consumed.accountId,
      action: "account.verify_email",
      objectType: "Account",
      objectId: consumed.accountId,
      correlationId: meta.correlationId,
    });
  });
}

export interface LoginResult {
  rawSessionToken: string;
  mfaRequired: boolean;
}

export async function login(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const account = await prisma.account.findUnique({ where: { email } });

  // Constant-shaped failure for "no such account" vs "wrong password" -
  // both return the same generic error (SRS-005).
  const genericFailure = () => new AuthenticationError("Invalid email or password.");

  if (!account) throw genericFailure();

  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    throw new AuthenticationError("This account is temporarily locked due to repeated failed attempts.");
  }

  const passwordOk = await verifyPassword(account.passwordHash, password);
  if (!passwordOk) {
    await recordFailedLogin(account.id);
    throw genericFailure();
  }

  if (account.status === AccountStatus.INVITED) {
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email before signing in.");
  }
  if (account.status === AccountStatus.SUSPENDED || account.status === AccountStatus.DEACTIVATED) {
    throw new AppError(403, "ACCOUNT_NOT_ACTIVE", "This account cannot sign in. Contact your administrator.");
  }

  const mfaRequired = account.mfaEnabledAt !== null;

  const { rawToken } = await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    const { rawToken: token, session } = await createSession(tx, {
      accountId: account.id,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      mfaVerified: !mfaRequired,
    });
    if (mfaRequired) {
      // Shrink the window an unverified session is usable in.
      await tx.session.update({
        where: { id: session.id },
        data: { absoluteExpiresAt: new Date(Date.now() + MFA_PENDING_SESSION_MINUTES * 60 * 1000) },
      });
    }
    await writeAuditEvent(tx, {
      actorId: account.id,
      action: "account.login",
      objectType: "Account",
      objectId: account.id,
      correlationId: meta.correlationId,
      metadata: { mfaRequired },
    });
    return { rawToken: token };
  });

  return { rawSessionToken: rawToken, mfaRequired };
}

async function recordFailedLogin(accountId: string): Promise<void> {
  const account = await prisma.account.update({
    where: { id: accountId },
    data: { failedLoginCount: { increment: 1 } },
  });
  if (account.failedLoginCount >= FAILED_LOGIN_LOCK_THRESHOLD) {
    await prisma.account.update({
      where: { id: accountId },
      data: { lockedUntil: new Date(Date.now() + FAILED_LOGIN_LOCK_MINUTES * 60 * 1000), failedLoginCount: 0 },
    });
  }
}

export async function completeMfa(rawSessionToken: string, code: string, meta: RequestMeta): Promise<void> {
  const resolved = await resolveSession(rawSessionToken);
  if (!resolved) throw new AuthenticationError();
  if (resolved.session.mfaVerified) return; // already verified, nothing to do

  const account = await prisma.account.findUnique({ where: { id: resolved.session.accountId } });
  if (!account || !account.mfaSecret) throw new AuthenticationError();

  if (!verifyTotpCode(account.mfaSecret, code)) {
    throw new AppError(400, "INVALID_MFA_CODE", "That code is incorrect or has expired.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: resolved.session.id },
      data: {
        mfaVerified: true,
        absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // reset to normal absolute lifetime
      },
    });
    await writeAuditEvent(tx, {
      actorId: account.id,
      action: "account.mfa_verify",
      objectType: "Account",
      objectId: account.id,
      correlationId: meta.correlationId,
    });
  });
}

export async function logout(rawSessionToken: string, meta: RequestMeta): Promise<void> {
  const resolved = await resolveSession(rawSessionToken);
  if (!resolved) return;
  await prisma.$transaction(async (tx) => {
    await revokeSession(tx, resolved.session.id, "logout");
    await writeAuditEvent(tx, {
      actorId: resolved.session.accountId,
      action: "account.logout",
      objectType: "Account",
      objectId: resolved.session.accountId,
      correlationId: meta.correlationId,
    });
  });
}

export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
  const account = await prisma.account.findUnique({ where: { email } });
  if (!account) return; // SRS-005: do not disclose account existence

  await prisma.$transaction(async (tx) => {
    const rawToken = await createRecoveryToken(tx, account.id, RecoveryPurpose.PASSWORD_RESET);
    await writeAuditEvent(tx, {
      actorId: account.id,
      action: "account.request_password_reset",
      objectType: "Account",
      objectId: account.id,
      correlationId: meta.correlationId,
    });
    await notificationPort.send({ to: email, template: "password-reset", data: { token: rawToken } });
  });
}

export async function confirmPasswordReset(rawToken: string, newPassword: string, meta: RequestMeta): Promise<void> {
  if (!isPasswordAcceptable(newPassword)) {
    throw new ValidationError("Password does not meet the minimum requirements.", {
      newPassword: "Must be at least 10 characters.",
    });
  }

  await prisma.$transaction(async (tx) => {
    const consumed = await consumeRecoveryToken(tx, rawToken, RecoveryPurpose.PASSWORD_RESET);
    if (!consumed) {
      throw new AppError(400, "INVALID_TOKEN", "This reset link is invalid or has expired.");
    }
    const passwordHash = await hashPassword(newPassword);
    await tx.account.update({
      where: { id: consumed.accountId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    // SRS-004: successful recovery invalidates the proof (handled by
    // consumeRecoveryToken) and existing sessions, and notifies the owner.
    await revokeAllSessionsForAccount(tx, consumed.accountId, "password_reset");
    await writeAuditEvent(tx, {
      actorId: consumed.accountId,
      action: "account.reset_password",
      objectType: "Account",
      objectId: consumed.accountId,
      correlationId: meta.correlationId,
    });
    const account = await tx.account.findUniqueOrThrow({ where: { id: consumed.accountId } });
    await notificationPort.send({ to: account.email, template: "account-status-changed", data: { reason: "password_reset" } });
  });
}

export type AccountStatusAction = "suspend" | "deactivate" | "reactivate";

// SRS-003: suspension/deactivation retains owned records and immediately
// revokes active sessions. Reactivation does not retroactively restore
// role grants that were separately revoked - only the account status.
export async function setAccountStatus(
  accountId: string,
  action: AccountStatusAction,
  actorId: string,
  reason: string | undefined,
  meta: RequestMeta
): Promise<void> {
  const nextStatus =
    action === "suspend" ? AccountStatus.SUSPENDED : action === "deactivate" ? AccountStatus.DEACTIVATED : AccountStatus.ACTIVE;

  await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError(404, "NOT_FOUND", "Account not found.");

    await tx.account.update({ where: { id: accountId }, data: { status: nextStatus } });

    if (action === "suspend" || action === "deactivate") {
      await revokeAllSessionsForAccount(tx, accountId, `account_${action}d`);
    }

    await writeAuditEvent(tx, {
      actorId,
      action: `account.${action}`,
      objectType: "Account",
      objectId: accountId,
      correlationId: meta.correlationId,
      metadata: reason ? { reason } : undefined,
    });
  });
}
