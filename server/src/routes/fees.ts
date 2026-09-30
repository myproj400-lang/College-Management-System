import { Router } from 'express';
import { PaymentMethod, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { academicYear } from '../lib/validation';
import { audit } from '../lib/audit';
import { assertCanViewStudent } from './people';

const formatReceipt = (n: number) => `RCPT-${String(n).padStart(6, '0')}`;

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
    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.feeInvoice.create({ data: body });
      await audit(tx, req.user!.id, 'invoice.create', 'FeeInvoice', inv.id, {
        studentId: inv.studentId,
        amount: inv.amount.toFixed(2),
        description: inv.description,
      });
      return inv;
    });
    res.status(201).json(invoice);
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
        const p = await tx.payment.create({ data: { ...body, invoiceId: invoice.id, recordedById: req.user!.id } });
        await audit(tx, req.user!.id, 'payment.create', 'Payment', p.id, {
          invoiceId: invoice.id,
          receiptNo: p.receiptNo,
          amount: p.amount.toFixed(2),
          method: p.method,
        });
        return p;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    res.status(201).json({ ...payment, receiptNumber: formatReceipt(payment.receiptNo) });
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
        receiptNumber: formatReceipt(p.receiptNo),
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

// Official payment receipt, for printing or showing proof of payment.
router.get(
  '/fees/payments/:id/receipt',
  asyncHandler(async (req, res) => {
    const p = await prisma.payment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        invoice: {
          include: {
            payments: { select: { amount: true, paidAt: true } },
            student: {
              select: {
                id: true,
                studentNumber: true,
                user: { select: { firstName: true, lastName: true } },
                programme: { select: { name: true } },
              },
            },
          },
        },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
    });
    assertCanViewStudent(req, p.invoice.studentId);

    // Balance as it stood right after this payment.
    const upToThis = { ...p.invoice, payments: p.invoice.payments.filter((x) => x.paidAt <= p.paidAt) };
    const s = p.invoice.student;
    res.json({
      receiptNumber: formatReceipt(p.receiptNo),
      paidAt: p.paidAt,
      amount: p.amount.toFixed(2),
      method: p.method,
      reference: p.reference,
      student: { studentNumber: s.studentNumber, name: `${s.user.firstName} ${s.user.lastName}`, programme: s.programme.name },
      invoice: { id: p.invoice.id, academicYear: p.invoice.academicYear, description: p.invoice.description },
      balanceAfterPayment: summarise(upToThis).balance,
      receivedBy: `${p.recordedBy.firstName} ${p.recordedBy.lastName}`,
    });
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
