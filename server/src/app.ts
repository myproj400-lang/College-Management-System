import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./shared/logger";
import { requestContext } from "./shared/requestContext";
import { errorHandler, notFoundHandler } from "./shared/errors";
import { healthRouter } from "./shared/health.routes";
import { authRouter } from "./modules/iam/auth.routes";
import { accountsRouter } from "./modules/iam/accounts.routes";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1); // needed for req.ip to be correct behind a reverse proxy

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as import("express").Request).correlationId,
      autoLogging: env.NODE_ENV !== "test",
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser(env.SESSION_COOKIE_SECRET));

  // Unversioned operational endpoints.
  app.use(healthRouter);

  // Versioned API surface (SRS §19 transport semantics: versioned JSON
  // resources). Everything business-facing lives under /api/v1.
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/accounts", accountsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
