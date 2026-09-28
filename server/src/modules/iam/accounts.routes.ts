import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import { writeAuditEvent } from "../../shared/audit";
import { AppError, ValidationError } from "../../shared/errors";
import { validateBody } from "../../shared/validate";
import { requireAuth, requireRole } from "./auth.middleware";
import * as authService from "./auth.service";
import { grantRole, listActiveGrantsForAccount, revokeRole } from "./roleGrant.service";
import { generateMfaSecret, buildEnrollmentUri, verifyTotpCode } from "./mfa.service";
import { grantRoleSchema, mfaEnrollConfirmSchema } from "./schemas";

export const accountsRouter = Router();

function requestMeta(req: import("express").Request) {
  return {
    userAgent: req.header("user-agent") ?? null,
    ipAddress: req.ip ?? null,
    correlationId: req.correlationId,
  };
}

const accountStatusSchema = z.object({
  action: z.enum(["suspend", "deactivate", "reactivate"]),
  reason: z.string().trim().max(500).optional(),
});

// SRS-003/IAM-02: account lifecycle transitions. Restricted to
// SYSTEM_ADMINISTRATOR - technical administration, not academic authority
// (CRS "System administrator: no inherent academic approval power").
accountsRouter.post(
  "/:accountId/status",
  requireAuth,
  requireRole(Role.SYSTEM_ADMINISTRATOR),
  validateBody(accountStatusSchema),
  async (req, res, next) => {
    try {
      await authService.setAccountStatus(
        req.params.accountId!,
        req.body.action,
        req.account!.id,
        req.body.reason,
        requestMeta(req)
      );
      const pastTense: Record<string, string> = {
        suspend: "suspended",
        deactivate: "deactivated",
        reactivate: "reactivated",
      };
      res.status(200).json({ message: `Account ${pastTense[req.body.action]}.` });
    } catch (err) {
      next(err);
    }
  }
);

accountsRouter.get("/:accountId/role-grants", requireAuth, requireRole(Role.SYSTEM_ADMINISTRATOR), async (req, res, next) => {
  try {
    const grants = await listActiveGrantsForAccount(req.params.accountId!);
    res.status(200).json({
      roleGrants: grants.map((g) => ({
        id: g.id,
        role: g.role,
        scopeType: g.scopeType,
        scopeId: g.scopeId,
        validFrom: g.validFrom,
        validTo: g.validTo,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// IAM-01: explicit role grants with scope, grantor and effective dates.
accountsRouter.post(
  "/:accountId/role-grants",
  requireAuth,
  requireRole(Role.SYSTEM_ADMINISTRATOR),
  validateBody(grantRoleSchema),
  async (req, res, next) => {
    try {
      const targetAccount = await prisma.account.findUnique({ where: { id: req.params.accountId } });
      if (!targetAccount) throw new AppError(404, "NOT_FOUND", "Account not found.");

      const grant = await prisma.$transaction((tx) =>
        grantRole(
          tx,
          {
            accountId: req.params.accountId!,
            role: req.body.role,
            scopeType: req.body.scopeType,
            scopeId: req.body.scopeId,
            reason: req.body.reason,
            validTo: req.body.validTo ? new Date(req.body.validTo) : undefined,
          },
          req.account!.id,
          requestMeta(req)
        )
      );
      res.status(201).json({ roleGrant: { id: grant.id, role: grant.role, scopeType: grant.scopeType, scopeId: grant.scopeId } });
    } catch (err) {
      next(err);
    }
  }
);

const revokeGrantSchema = z.object({ reason: z.string().trim().max(500).optional() });

accountsRouter.post(
  "/role-grants/:roleGrantId/revoke",
  requireAuth,
  requireRole(Role.SYSTEM_ADMINISTRATOR),
  validateBody(revokeGrantSchema),
  async (req, res, next) => {
    try {
      await prisma.$transaction((tx) => revokeRole(tx, req.params.roleGrantId!, req.account!.id, req.body.reason, requestMeta(req)));
      res.status(200).json({ message: "Role grant revoked." });
    } catch (err) {
      next(err);
    }
  }
);

// --- Self-service MFA enrollment (SEC-01: privileged roles require MFA) ---

accountsRouter.post("/me/mfa/enroll", requireAuth, async (req, res, next) => {
  try {
    if (req.account!.mfaEnabledAt) {
      throw new ValidationError("MFA is already enabled for this account.");
    }
    const secret = generateMfaSecret();
    await prisma.account.update({ where: { id: req.account!.id }, data: { mfaSecret: secret } });
    res.status(200).json({
      secret,
      enrollmentUri: buildEnrollmentUri(req.account!.email, secret),
    });
  } catch (err) {
    next(err);
  }
});

accountsRouter.post("/me/mfa/enroll/confirm", requireAuth, validateBody(mfaEnrollConfirmSchema), async (req, res, next) => {
  try {
    const account = req.account!;
    if (!account.mfaSecret) {
      throw new ValidationError("Start enrollment first by calling POST /accounts/me/mfa/enroll.");
    }
    if (!verifyTotpCode(account.mfaSecret, req.body.code)) {
      throw new AppError(400, "INVALID_MFA_CODE", "That code is incorrect or has expired.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: account.id }, data: { mfaEnabledAt: new Date() } });
      await writeAuditEvent(tx, {
        actorId: account.id,
        action: "account.mfa_enroll",
        objectType: "Account",
        objectId: account.id,
        correlationId: req.correlationId,
      });
    });
    res.status(200).json({ message: "MFA enabled." });
  } catch (err) {
    next(err);
  }
});
