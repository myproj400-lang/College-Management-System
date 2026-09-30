import { Prisma } from '@prisma/client';
import { prisma } from '../db';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Records a sensitive change. Pass the transaction client when the change
 * itself runs in a transaction, so the log entry commits or rolls back with it.
 */
export async function audit(
  db: Db,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  details?: Record<string, unknown>,
) {
  await db.auditLog.create({
    data: { actorId, action, entity, entityId, details: details as Prisma.InputJsonValue | undefined },
  });
}
