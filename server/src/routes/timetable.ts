import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { academicYear, semester } from '../lib/validation';
import { findTerm } from '../lib/terms';
import { assertCanViewStudent } from './people';

// Weekly class timetable with room and lecturer clash detection.
const router = Router();
const canManage = requireRole('ADMIN', 'REGISTRAR');

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

const sessionBody = z
  .object({
    courseId: z.string().min(1),
    academicYear,
    semester,
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: time,
    endTime: time,
    room: z.string().trim().min(1).max(50),
  })
  .refine((s) => s.endTime > s.startTime, { message: 'endTime must be after startTime', path: ['endTime'] });

type SessionInput = z.infer<typeof sessionBody>;

const sessionInclude = {
  course: {
    select: {
      id: true,
      code: true,
      title: true,
      lecturer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.ClassSessionInclude;

/** Rejects a slot that overlaps another in the same room, or another taught by the same lecturer. */
async function assertNoClash(s: SessionInput, excludeId?: string) {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: s.courseId }, select: { lecturerId: true } });
  const overlapping = await prisma.classSession.findMany({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      academicYear: s.academicYear,
      semester: s.semester,
      dayOfWeek: s.dayOfWeek,
      startTime: { lt: s.endTime },
      endTime: { gt: s.startTime },
    },
    include: { course: { select: { code: true, lecturerId: true } } },
  });
  for (const o of overlapping) {
    if (o.room.toLowerCase() === s.room.toLowerCase()) {
      throw new HttpError(409, `Room ${o.room} is already booked for ${o.course.code} (${o.startTime}–${o.endTime})`);
    }
    if (course.lecturerId && o.course.lecturerId === course.lecturerId) {
      throw new HttpError(409, `The lecturer already teaches ${o.course.code} at ${o.startTime}–${o.endTime}`);
    }
  }
}

const byDayAndTime = { orderBy: [{ dayOfWeek: 'asc' as const }, { startTime: 'asc' as const }] };

router.get(
  '/timetable',
  asyncHandler(async (req, res) => {
    const q = z
      .object({ academicYear, semester, courseId: z.string().optional(), room: z.string().optional() })
      .parse(req.query);
    res.json(await prisma.classSession.findMany({ where: q, include: sessionInclude, ...byDayAndTime }));
  }),
);

router.post(
  '/timetable',
  canManage,
  asyncHandler(async (req, res) => {
    const body = sessionBody.parse(req.body);
    await findTerm(prisma, body.academicYear, body.semester);
    await assertNoClash(body);
    res.status(201).json(await prisma.classSession.create({ data: body, include: sessionInclude }));
  }),
);

router.patch(
  '/timetable/:id',
  canManage,
  asyncHandler(async (req, res) => {
    const existing = await prisma.classSession.findUniqueOrThrow({ where: { id: req.params.id } });
    const merged = sessionBody.parse({ ...existing, ...req.body });
    await assertNoClash(merged, existing.id);
    res.json(await prisma.classSession.update({ where: { id: existing.id }, data: merged, include: sessionInclude }));
  }),
);

router.delete(
  '/timetable/:id',
  canManage,
  asyncHandler(async (req, res) => {
    await prisma.classSession.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

const termQuery = z.object({ academicYear, semester });

router.get(
  '/students/:id/timetable',
  asyncHandler(async (req: Request, res) => {
    assertCanViewStudent(req, req.params.id);
    const q = termQuery.parse(req.query);
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: req.params.id, ...q, status: { not: 'DROPPED' } },
      select: { courseId: true },
    });
    res.json(
      await prisma.classSession.findMany({
        where: { ...q, courseId: { in: enrollments.map((e) => e.courseId) } },
        include: sessionInclude,
        ...byDayAndTime,
      }),
    );
  }),
);

router.get(
  '/staff/:id/timetable',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    if (!['ADMIN', 'REGISTRAR'].includes(u.role) && u.staffId !== req.params.id) {
      throw new HttpError(403, 'You do not have permission to view this timetable');
    }
    const q = termQuery.parse(req.query);
    res.json(
      await prisma.classSession.findMany({
        where: { ...q, course: { lecturerId: req.params.id } },
        include: sessionInclude,
        ...byDayAndTime,
      }),
    );
  }),
);

export default router;
