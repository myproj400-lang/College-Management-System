import type { Prisma, PrismaClient, Role, RoleGrant } from "@prisma/client";
import { RoleGrantStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import { AppError, ValidationError } from "../../shared/errors";
import { writeAuditEvent } from "../../shared/audit";
import { roleRequiresMfa } from "./mfa.service";
import type { RequestMeta } from "./auth.service";

type TxClient = Prisma.TransactionClient | PrismaClient;

export interface GrantRoleInput {
  accountId: string;
  role: Role;
  scopeType: string;
  scopeId?: string;
  reason?: string;
  validTo?: Date;
}

// SRS-002/IAM-01: role, scope, effective dates and grantor are all
// recorded explicitly. SEC-01: privileged roles require MFA - enforced
// here as a precondition of the grant existing at all, rather than as a
// runtime special case scattered through login/session code.
export async function grantRole(
  tx: TxClient,
  input: GrantRoleInput,
  grantedById: string,
  meta: RequestMeta
): Promise<RoleGrant> {
  if (roleRequiresMfa(input.role)) {
    const account = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!account?.mfaEnabledAt) {
      throw new ValidationError(
        `The role ${input.role} requires multi-factor authentication. The account must complete MFA enrollment before this role can be granted.`
      );
    }
  }

  const grant = await tx.roleGrant.create({
    data: {
      accountId: input.accountId,
      role: input.role,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      grantedById,
      reason: input.reason,
      validTo: input.validTo,
    },
  });

  await writeAuditEvent(tx, {
    actorId: grantedById,
    action: "role_grant.create",
    objectType: "RoleGrant",
    objectId: grant.id,
    correlationId: meta.correlationId,
    metadata: { accountId: input.accountId, role: input.role, scopeType: input.scopeType, scopeId: input.scopeId },
  });

  return grant;
}

export async function revokeRole(tx: TxClient, roleGrantId: string, actorId: string, reason: string | undefined, meta: RequestMeta): Promise<void> {
  const grant = await tx.roleGrant.findUnique({ where: { id: roleGrantId } });
  if (!grant) throw new AppError(404, "NOT_FOUND", "Role grant not found.");
  if (grant.status === RoleGrantStatus.REVOKED) return;

  await tx.roleGrant.update({
    where: { id: roleGrantId },
    data: { status: RoleGrantStatus.REVOKED, revokedAt: new Date() },
  });

  // SRS-002: revocation must apply to the *next* protected request - there
  // is deliberately no session invalidation here. Access is re-evaluated
  // per-request against active grants, so the very next call already sees
  // the revoked grant as gone.
  await writeAuditEvent(tx, {
    actorId,
    action: "role_grant.revoke",
    objectType: "RoleGrant",
    objectId: roleGrantId,
    correlationId: meta.correlationId,
    metadata: reason ? { reason } : undefined,
  });
}

export async function listActiveGrantsForAccount(accountId: string): Promise<RoleGrant[]> {
  const now = new Date();
  return prisma.roleGrant.findMany({
    where: {
      accountId,
      status: RoleGrantStatus.ACTIVE,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
  });
}

export async function hasActiveRole(
  accountId: string,
  role: Role,
  scope?: { scopeType: string; scopeId?: string }
): Promise<boolean> {
  const grants = await listActiveGrantsForAccount(accountId);
  return grants.some((grant) => {
    if (grant.role !== role) return false;
    if (!scope) return true;
    if (grant.scopeType !== scope.scopeType) return false;
    // A null scopeId on the grant means institution-wide for that role/type.
    if (grant.scopeId === null) return true;
    return grant.scopeId === scope.scopeId;
  });
}
