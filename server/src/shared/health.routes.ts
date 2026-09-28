import { Router } from "express";
import { prisma } from "./prisma";

export const healthRouter = Router();

// Liveness: process is up. No dependency checks.
healthRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness: process is up AND its dependencies (database) are reachable.
// SRS-074: operational visibility into service health.
healthRouter.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready", database: "up" });
  } catch {
    res.status(503).json({ status: "not_ready", database: "down" });
  }
});
