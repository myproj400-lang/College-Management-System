import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

export interface AuditInput {
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

// Always called from inside the same transaction as the business change it
// records, so the audit trail cannot exist without the change it describes
// (or vice versa) - SEC-04, SRS-063. Never call this after a transaction
// commits as a "best effort" follow-up.
export async function writeAuditEvent(tx: TxClient, input: AuditInput) {
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      correlationId: input.correlationId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
