import { z } from "zod";
import { Role } from "@prisma/client";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1), // full strength check happens in the service (isPasswordAcceptable)
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const mfaVerifySchema = z.object({
  code: z.string().length(6),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

export const grantRoleSchema = z.object({
  role: z.nativeEnum(Role),
  scopeType: z.string().trim().min(1).max(64),
  scopeId: z.string().trim().min(1).max(128).optional(),
  reason: z.string().trim().max(500).optional(),
  validTo: z.string().datetime().optional(),
});

export const mfaEnrollConfirmSchema = z.object({
  code: z.string().length(6),
});
