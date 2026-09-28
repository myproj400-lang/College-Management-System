import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { validateBody } from "../../shared/validate";
import {
  confirmPasswordResetSchema,
  loginSchema,
  mfaVerifySchema,
  registerSchema,
  requestPasswordResetSchema,
  verifyEmailSchema,
} from "./schemas";
import * as authService from "./auth.service";
import { requireAuth, requireSession } from "./auth.middleware";
import { SESSION_COOKIE_NAME as COOKIE_NAME } from "./session.service";
import { listActiveGrantsForAccount } from "./roleGrant.service";

export const authRouter = Router();

// SRS-005: throttle authentication/recovery endpoints against abuse.
// IP-scoped here; account-scoped lockout is separately enforced in
// auth.service.recordFailedLogin. A single-instance limiter is sufficient
// for this phase - multi-instance deployment needs a shared store, noted
// in server/README.md as an operational follow-up.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 100000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
});

function requestMeta(req: import("express").Request) {
  return {
    userAgent: req.header("user-agent") ?? null,
    ipAddress: req.ip ?? null,
    correlationId: req.correlationId,
  };
}

const isProduction = env.NODE_ENV === "production";

function setSessionCookie(res: import("express").Response, rawToken: string) {
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: env.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res: import("express").Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

authRouter.post("/register", authLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    await authService.register(req.body.email, req.body.password, requestMeta(req));
    // Always the same response, whether or not the email was already taken.
    res.status(202).json({
      message: "If this email can be registered, a verification link has been sent.",
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/verify-email", authLimiter, validateBody(verifyEmailSchema), async (req, res, next) => {
  try {
    await authService.verifyEmail(req.body.token, requestMeta(req));
    res.status(200).json({ message: "Email verified. You can now sign in." });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", authLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body.email, req.body.password, requestMeta(req));
    setSessionCookie(res, result.rawSessionToken);
    res.status(200).json({ mfaRequired: result.mfaRequired });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/mfa/verify", authLimiter, requireSession, validateBody(mfaVerifySchema), async (req, res, next) => {
  try {
    const token = req.signedCookies?.[COOKIE_NAME] as string;
    await authService.completeMfa(token, req.body.code, requestMeta(req));
    res.status(200).json({ message: "MFA verified." });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireSession, async (req, res, next) => {
  try {
    const token = req.signedCookies?.[COOKIE_NAME] as string;
    await authService.logout(token, requestMeta(req));
    clearSessionCookie(res);
    res.status(200).json({ message: "Signed out." });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/password-reset/request", authLimiter, validateBody(requestPasswordResetSchema), async (req, res, next) => {
  try {
    await authService.requestPasswordReset(req.body.email, requestMeta(req));
    res.status(202).json({ message: "If this email is registered, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/password-reset/confirm", authLimiter, validateBody(confirmPasswordResetSchema), async (req, res, next) => {
  try {
    await authService.confirmPasswordReset(req.body.token, req.body.newPassword, requestMeta(req));
    res.status(200).json({ message: "Password updated. Sign in with your new password." });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const grants = await listActiveGrantsForAccount(req.account!.id);
    res.status(200).json({
      account: {
        id: req.account!.id,
        email: req.account!.email,
        status: req.account!.status,
        mfaEnabled: req.account!.mfaEnabledAt !== null,
      },
      roleGrants: grants.map((g) => ({ id: g.id, role: g.role, scopeType: g.scopeType, scopeId: g.scopeId, validTo: g.validTo })),
    });
  } catch (err) {
    next(err);
  }
});
