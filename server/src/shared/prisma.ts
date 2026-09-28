import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

// One shared client instance per process. Every write that must be atomic
// with its audit event (SEC-04) uses prisma.$transaction, never a bare
// prisma.<model>.create followed by a separate audit write.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
