import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { academicYear, pagination, paging, semester } from '../lib/validation';
import { academicStanding, computeGpa, GRADE_SCALE, PROBATION_CGPA } from '../lib/grading';

// Management reports and the audit trail.
const router = Router();

router.get(
  '/reports/summary',
  requireRole('ADMIN', 'REGISTRAR', 'BURSAR'),
  asyncHandler(async (_req, res) => {
    const [byStatus, byProgramme, programmes, staffCount, courseCount, invoiced, paid] = await Promise.all([
      prisma.student.groupBy({ by: ['status'], _count: true }),
      prisma.student.groupBy({ by: ['programmeId'], where: { status: 'ACTIVE' }, _count: true }),
      prisma.programme.findMany({ select: { id: true, code: true, name: true } }),
      prisma.staff.count(),
      prisma.course.count(),
      prisma.feeInvoice.aggregate({ _sum: { amount: true } }),
      prisma.payment.aggregate({ _sum: { amount: true } }),
    ]);
    const names = new Map(programmes.map((p) => [p.id, p]));
    const billed = invoiced._sum.amount ?? new Prisma.Decimal(0);
    const collected = paid._sum.amount ?? new Prisma.Decimal(0);

    res.json({
      students: {
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        activeByProgramme: byProgramme.map((p) => ({ programme: names.get(p.programmeId), count: p._count })),
      },
      staff: staffCount,
      courses: courseCount,
      fees: {
        billed: billed.toFixed(2),
        collected: collected.toFixed(2),
        outstanding: billed.minus(collected).toFixed(2),
      },
    });
  }),
);

router.get(
  '/reports/courses/:id/results',
  requireRole('ADMIN', 'REGISTRAR', 'LECTURER'),
  asyncHandler(async (req, res) => {
    const q = z.object({ academicYear, semester }).parse(req.query);
    const course = await prisma.course.findUniqueOrThrow({ where: { id: req.params.id } });
    if (req.user!.role === 'LECTURER' && course.lecturerId !== req.user!.staffId) {
      throw new HttpError(403, 'You do not teach this course');
    }
    const rows = await prisma.enrollment.findMany({
      where: { courseId: course.id, ...q, status: { not: 'DROPPED' } },
      select: { score: true, grade: true },
    });
    const scores = rows.map((r) => r.score).filter((s): s is number => s !== null);
    const distribution = Object.fromEntries(GRADE_SCALE.map((b) => [b.grade, 0]));
    for (const r of rows) if (r.grade) distribution[r.grade]++;

    res.json({
      course: { id: course.id, code: course.code, title: course.title },
      enrolled: rows.length,
      graded: scores.length,
      average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
      highest: scores.length ? Math.max(...scores) : null,
      lowest: scores.length ? Math.min(...scores) : null,
      passRate: scores.length ? Math.round((rows.filter((r) => r.grade && r.grade !== 'F').length / scores.length) * 1000) / 10 : null,
      distribution,
    });
  }),
);

// Active students whose CGPA is below the probation threshold.
router.get(
  '/reports/probation',
  requireRole('ADMIN', 'REGISTRAR'),
  asyncHandler(async (_req, res) => {
    const students = await prisma.student.findMany({
      where: { status: 'ACTIVE' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        programme: { select: { code: true } },
        enrollments: {
          where: { status: 'COMPLETED' },
          select: { gradePoint: true, course: { select: { creditHours: true } } },
        },
      },
    });
    const list = students
      .map((s) => {
        const cgpa = computeGpa(s.enrollments.map((e) => ({ gradePoint: e.gradePoint, creditHours: e.course.creditHours })));
        return {
          id: s.id,
          studentNumber: s.studentNumber,
          name: `${s.user.firstName} ${s.user.lastName}`,
          email: s.user.email,
          programme: s.programme.code,
          yearOfStudy: s.yearOfStudy,
          cgpa,
          standing: academicStanding(cgpa),
        };
      })
      .filter((s) => s.standing === 'PROBATION')
      .sort((a, b) => (a.cgpa ?? 0) - (b.cgpa ?? 0));
    res.json({ threshold: PROBATION_CGPA, students: list });
  }),
);

router.get(
  '/audit-logs',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const q = pagination
      .extend({
        entity: z.string().optional(),
        entityId: z.string().optional(),
        actorId: z.string().optional(),
        action: z.string().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    const where = {
      entity: q.entity,
      entityId: q.entityId,
      actorId: q.actorId,
      action: q.action,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { email: true, firstName: true, lastName: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        ...paging(q),
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

export default router;
