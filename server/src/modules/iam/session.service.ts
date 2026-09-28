import type { Prisma, PrismaClient, Session } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import { env } from "../../config/env";
import { generateOpaqueToken, hashToken } from "./tokens";

type TxClient = Prisma.TransactionClient | PrismaClient;

export const SESSION_COOKIE_NAME = "icms_session";

export interface CreateSessionInput {
  accountId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  mfaVerified: boolean;
}

// SRS-006/SEC-02: idle and absolute session expiry, explicit logout and
// server-side revocation. Sessions are opaque server-side records, not
// self-contained JWTs, precisely so that suspension/revocation is
// effective on the *next* request rather than only after the token would
// naturally expire.
export async function createSession(tx: TxClient, input: CreateSessionInput): Promise<{ rawToken: string; session: Session }> {
  const rawToken = generateOpaqueToken();
  const absoluteExpiresAt = new Date(Date.now() + env.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000);
  const session = await tx.session.create({
    data: {
      accountId: input.accountId,
      tokenHash: hashToken(rawToken),
      mfaVerified: input.mfaVerified,
      userAgent: input.userAgent ?? undefined,
      ipAddress: input.ipAddress ?? undefined,
      absoluteExpiresAt,
    },
  });
  return { rawToken, session };
}

export interface ResolvedSession {
  session: Session;
}

// Returns null for any invalid/expired/revoked session rather than
// distinguishing the reason to the caller - callers should not leak which
// specific condition failed (SRS §4 acceptance boundary).
export async function resolveSession(rawToken: string): Promise<ResolvedSession | null> {
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { tokenHash } });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  if (session.absoluteExpiresAt.getTime() <= now) {
    await revokeSession(prisma, session.id, "absolute_expiry");
    return null;
  }
  const idleDeadline = session.lastSeenAt.getTime() + env.SESSION_IDLE_MINUTES * 60 * 1000;
  if (idleDeadline <= now) {
    await revokeSession(prisma, session.id, "idle_expiry");
    return null;
  }

  await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return { session };
}

export async function revokeSession(tx: TxClient, sessionId: string, reason: string): Promise<void> {
  await tx.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeAllSessionsForAccount(tx: TxClient, accountId: string, reason: string): Promise<void> {
  await tx.session.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}
