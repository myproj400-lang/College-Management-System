import type { NextFunction, Request, Response } from "express";
import type { Account, Role, RoleGrant, Session } from "@prisma/client";
import { AppError, AuthenticationError, ForbiddenError } from "../../shared/errors";
import { prisma } from "../../shared/prisma";
import { resolveSession, SESSION_COOKIE_NAME } from "./session.service";
import { listActiveGrantsForAccount } from "./roleGrant.service";

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
    account?: Account;
    activeGrants?: RoleGrant[];
  }
}

function readSessionToken(req: Request): string | undefined {
  return (req.signedCookies?.[SESSION_COOKIE_NAME] as string | undefined) ?? undefined;
}

// Resolves the session but does not require MFA to already be complete -
// used only by the small set of routes reachable mid-MFA-challenge
// (mfa verify, logout, "who am I").
export async function requireSession(req: Request, _res: Response, next: NextFunction) {
  const token = readSessionToken(req);
  if (!token) return next(new AuthenticationError());
  const resolved = await resolveSession(token);
  if (!resolved) return next(new AuthenticationError());
  req.session = resolved.session;
  next();
}

// Full protected-route guard: valid, non-expired, non-revoked session AND
// (if the account has MFA enrolled) MFA already completed for this
// session. Also loads the account and its currently active role grants so
// downstream handlers/requireRole never re-derive them (INT-01: every
// protected request is independently authorised on the server).
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  await requireSession(req, res, async (err?: unknown) => {
    if (err) return next(err);
    const session = req.session!;
    if (!session.mfaVerified) {
      return next(new AppError(403, "MFA_REQUIRED", "Complete multi-factor authentication to continue."));
    }
    const account = await prisma.account.findUnique({ where: { id: session.accountId } });
    if (!account || account.status !== "ACTIVE") {
      return next(new AuthenticationError());
    }
    req.account = account;
    req.activeGrants = await listActiveGrantsForAccount(account.id);
    next();
  });
}

export type ScopeResolver = (req: Request) => { scopeType: string; scopeId?: string } | undefined;

// Coarse-grained role check for this phase. Fine-grained ownership checks
// (e.g. "this lecturer's assigned offering") are added module-by-module as
// those resources are implemented; this only verifies an active grant for
// the role and, if a scope resolver is given, a matching scope.
export function requireRole(role: Role, scopeResolver?: ScopeResolver) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const grants = req.activeGrants ?? [];
    const scope = scopeResolver?.(req);
    const matches = grants.some((grant) => {
      if (grant.role !== role) return false;
      if (!scope) return true;
      if (grant.scopeType !== scope.scopeType) return false;
      if (grant.scopeId === null) return true;
      return grant.scopeId === scope.scopeId;
    });
    if (!matches) return next(new ForbiddenError());
    next();
  };
}
