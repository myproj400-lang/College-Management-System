import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../middleware/error';

type Db = Prisma.TransactionClient | typeof prisma;

export async function findTerm(db: Db, academicYear: string, semester: number) {
  const term = await db.academicTerm.findUnique({ where: { academicYear_semester: { academicYear, semester } } });
  if (!term) throw new HttpError(400, `No academic term ${academicYear} semester ${semester} has been set up`);
  return term;
}

export function registrationOpen(term: { registrationOpensAt: Date; registrationClosesAt: Date }, now = new Date()) {
  return now >= term.registrationOpensAt && now <= term.registrationClosesAt;
}

/** Terms whose results have been published — the only ones students can see grades for. */
export async function publishedTermKeys(db: Db): Promise<Set<string>> {
  const terms = await db.academicTerm.findMany({
    where: { resultsPublishedAt: { not: null } },
    select: { academicYear: true, semester: true },
  });
  return new Set(terms.map((t) => termKey(t.academicYear, t.semester)));
}

export const termKey = (academicYear: string, semester: number) => `${academicYear}#${semester}`;

/** Outstanding balance on invoices already past their due date. */
export async function overdueBalance(db: Db, studentId: string, now = new Date()): Promise<Prisma.Decimal> {
  const invoices = await db.feeInvoice.findMany({
    where: { studentId, dueDate: { lt: now } },
    include: { payments: { select: { amount: true } } },
  });
  return invoices.reduce((sum, inv) => {
    const paid = inv.payments.reduce((p, x) => p.plus(x.amount), new Prisma.Decimal(0));
    return sum.plus(inv.amount.minus(paid));
  }, new Prisma.Decimal(0));
}
