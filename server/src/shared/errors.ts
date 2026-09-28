import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

// SRS §19 transport/error semantics: responses distinguish unauthenticated,
// forbidden/concealed-not-found, validation failure, stale revision,
// throttling and temporary unavailability. Error bodies carry a stable
// code + safe message + optional field errors - never a stack trace or
// an internal exception message.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "The request is invalid.", fields?: Record<string, string>) {
    super(422, "VALIDATION_FAILED", message, fields);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication is required.") {
    super(401, "UNAUTHENTICATED", message);
  }
}

// Used for both "forbidden" and "not found" cases where distinguishing
// them would disclose that a record exists (SRS §4 acceptance boundary:
// "expected outcome is denial without disclosing the target record").
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(403, "FORBIDDEN", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The record has changed since it was last read.") {
    super(409, "CONFLICT", message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many attempts. Try again later.") {
    super(429, "RATE_LIMITED", message);
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      fields[issue.path.join(".") || "_"] = issue.message;
    }
    res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "The request is invalid.", fields } });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err, correlationId: (req as { correlationId?: string }).correlationId }, err.message);
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
    });
    return;
  }

  logger.error({ err, correlationId: (req as { correlationId?: string }).correlationId }, "Unhandled error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Try again shortly." } });
}
