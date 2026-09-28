import pino from "pino";
import { env } from "../config/env";

// SRS-062/SRS-005: secrets, passwords, tokens must never appear in logs.
// Redaction is applied structurally so a developer adding a new field with
// one of these names is protected by default rather than having to
// remember to scrub it at each call site.
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "token",
      "*.token",
      "sessionToken",
      "recoveryToken",
      "mfaSecret",
      "*.mfaSecret",
      "req.headers.cookie",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
});
