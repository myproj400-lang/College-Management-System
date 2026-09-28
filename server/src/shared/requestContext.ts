import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
  }
}

// Every request gets a correlation ID, propagated into logs and audit
// events, so a single business action's evidence (SRS-054, SEC-04) can be
// reconstructed across the request even when it touches several modules.
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-correlation-id");
  req.correlationId = incoming && incoming.length <= 100 ? incoming : uuidv4();
  res.setHeader("x-correlation-id", req.correlationId);
  next();
}
