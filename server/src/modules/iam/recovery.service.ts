import type { Prisma, PrismaClient } from "@prisma/client";
import { RecoveryPurpose } from "@prisma/client";
import { env } from "../../config/env";
import { generateOpaqueToken, hashToken } from "./tokens";

type TxClient = Prisma.TransactionClient | PrismaClient;

// SRS-004: single-use, expiring, non-recoverable proof for both email
// verification and password reset.
export async function createRecoveryToken(
  tx: TxClient,
  accountId: string,
  purpose: RecoveryPurpose
): Promise<string> {
  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.RECOVERY_TOKEN_TTL_MINUTES * 60 * 1000);
  await tx.recoveryToken.create({
    data: { accountId, purpose, tokenHash: hashToken(rawToken), expiresAt },
  });
  return rawToken;
}

export interface ConsumedToken {
  accountId: string;
}

// Atomically marks the token used only if it is still valid, so a replayed
// or concurrently-consumed token cannot succeed twice (SRS-004 "recovery
// replay" verification target). Returns null on any invalid/expired/
// already-used token - callers must not distinguish the reason.
export async function consumeRecoveryToken(
  tx: TxClient,
  rawToken: string,
  purpose: RecoveryPurpose
): Promise<ConsumedToken | null> {
  const tokenHash = hashToken(rawToken);
  const candidate = await tx.recoveryToken.findUnique({ where: { tokenHash } });
  if (!candidate || candidate.purpose !== purpose) return null;
  if (candidate.usedAt || candidate.expiresAt.getTime() <= Date.now()) return null;

  const result = await tx.recoveryToken.updateMany({
    where: { id: candidate.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) return null; // lost a race with a concurrent consumer

  return { accountId: candidate.accountId };
}
