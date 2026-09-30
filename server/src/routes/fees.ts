import { Router } from 'express';
import { PaymentMethod, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { academicYear } from '../lib/validation';
import { assertCanViewStudent } from './people';

// Fee invoices and payments.
const router = Router();
const canManage = requireRole('ADMIN', 'BURSAR');

const money = z.coerce
  .number()
  .positive()
  .max(1_000_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: 'At most two decimal places' });

function summarise(invoice: { amount: Prisma.Decimal; payments: { amount: Prisma.Decimal }[] }) {
  const paid = invoice.payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  return { amount: invoice.amount.toFixed(2), paid: paid.toFixed(2), balance: invoice.amount.minus(paid).toFixed(2) };
}

router.post(
  '/fees/invoices',
  canManage,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        studentId: z.string().min(1),
        academicYear,
        description: z.string().trim().min(2).max(200),
        amount: money,
        dueDate: z.coerce.date(),
      })
      .parse(req.body);
    res.status(201).json(await prisma.feeInvoice.create({ data: body }));
  }),
);

router.post(
  '/fees/invoices/:id/payments',
  canManage,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        amount: money,
        method: z.nativeEnum(PaymentMethod),
        reference: z.string().trim().max(100).optional(),
        paidAt: z.coerce.date().optional(),
      })
      .parse(req.body);

    const payment = await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.feeInvoice.findUniqueOrThrow({
          where: { id: req.params.id },
          include: { payments: { select: { amount: true } } },
        });
        const balance = new Prisma.Decimal(summarise(invoice).balance);
        if (balance.lessThan(body.amount)) {
          throw new HttpError(400, `Payment exceeds the outstanding balance of ${balance.toFixed(2)}`);
        }
        return tx.payment.create({ data: { ...body, invoiceId: invoice.id, recordedById: req.user!.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    res.status(201).json(payment);
  }),
);

router.get(
  '/students/:id/fees',
  asyncHandler(async (req, res) => {
    assertCanViewStudent(req, req.params.id);
    const invoices = await prisma.feeInvoice.findMany({
      where: { studentId: req.params.id },
      include: { payments: { orderBy: { paidAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    const items = invoices.map((inv) => ({
      id: inv.id,
      academicYear: inv.academicYear,
      description: inv.description,
      dueDate: inv.dueDate,
      ...summarise(inv),
      payments: inv.payments.map((p) => ({
        id: p.id,
        amount: p.amount.toFixed(2),
        method: p.method,
        reference: p.reference,
        paidAt: p.paidAt,
      })),
    }));
    const totalBalance = invoices
      .reduce((sum, inv) => sum.plus(summarise(inv).balance), new Prisma.Decimal(0))
      .toFixed(2);
    res.json({ invoices: items, totalBalance });
  }),
);

router.get(
  '/fees/outstanding',
  canManage,
  asyncHandler(async (_req, res) => {
    const invoices = await prisma.feeInvoice.findMany({
      include: {
        payments: { select: { amount: true } },
        student: { select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });
    res.json(
      invoices
        .map((inv) => ({ id: inv.id, student: inv.student, description: inv.description, dueDate: inv.dueDate, ...summarise(inv) }))
        .filter((inv) => new Prisma.Decimal(inv.balance).greaterThan(0)),
    );
  }),
);

export default router;
