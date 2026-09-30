import { Router, Request } from 'express';
import { AttendanceStatus, EnrollmentStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { academicYear, semester } from '../lib/validation';
import { computeGpa, gradeFor } from '../lib/grading';
import { assertCanViewStudent } from './people';

// Enrollments, grades, attendance and transcripts.
const router = Router();

const isOffice = (req: Request) => ['ADMIN', 'REGISTRAR'].includes(req.user!.role);

/** Office staff may manage any course; a lecturer only the courses assigned to them. */
async function assertCanManageCourse(req: Request, courseId: string) {
  if (isOffice(req)) return;
  if (req.user!.role === 'LECTURER') {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { lecturerId: true } });
    if (course && course.lecturerId && course.lecturerId === req.user!.staffId) return;
  }
  throw new HttpError(403, 'You do not teach this course');
}

// ---- Enrollments -----------------------------------------------------------

router.get(
  '/enrollments',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        studentId: z.string().optional(),
        courseId: z.string().optional(),
        academicYear: academicYear.optional(),
        semester: semester.optional(),
      })
      .parse(req.query);

    const u = req.user!;
    if (u.role === 'STUDENT') {
      q.studentId = u.studentId ?? '__none__';
    } else if (u.role === 'LECTURER') {
      if (!q.courseId) throw new HttpError(400, 'courseId is required');
      await assertCanManageCourse(req, q.courseId);
    } else if (!isOffice(req) && u.role !== 'BURSAR') {
      throw new HttpError(403, 'You do not have permission to view enrollments');
    }

    res.json(
      await prisma.enrollment.findMany({
        where: q,
        include: {
          course: { select: { id: true, code: true, title: true, creditHours: true } },
          student: {
            select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: [{ academicYear: 'desc' }, { semester: 'desc' }],
      }),
    );
  }),
);

router.post(
  '/enrollments',
  requireRole('ADMIN', 'REGISTRAR', 'STUDENT'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ studentId: z.string().min(1), courseId: z.string().min(1), academicYear, semester })
      .parse(req.body);
    if (req.user!.role === 'STUDENT' && req.user!.studentId !== body.studentId) {
      throw new HttpError(403, 'Students can only register themselves');
    }
    const student = await prisma.student.findUniqueOrThrow({ where: { id: body.studentId } });
    if (student.status !== 'ACTIVE') throw new HttpError(400, `Student is ${student.status.toLowerCase()}`);

    res.status(201).json(await prisma.enrollment.create({ data: body, include: { course: true } }));
  }),
);

router.patch(
  '/enrollments/:id/status',
  requireRole('ADMIN', 'REGISTRAR'),
  asyncHandler(async (req, res) => {
    const body = z.object({ status: z.nativeEnum(EnrollmentStatus) }).parse(req.body);
    res.json(await prisma.enrollment.update({ where: { id: req.params.id }, data: body }));
  }),
);

// ---- Grades ----------------------------------------------------------------

router.put(
  '/enrollments/:id/grade',
  requireRole('ADMIN', 'REGISTRAR', 'LECTURER'),
  asyncHandler(async (req, res) => {
    const { score } = z.object({ score: z.number().min(0).max(100) }).parse(req.body);
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: req.params.id } });
    await assertCanManageCourse(req, enrollment.courseId);
    if (enrollment.status === 'DROPPED') throw new HttpError(400, 'Cannot grade a dropped course');

    res.json(
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { score, ...gradeFor(score), status: 'COMPLETED' },
      }),
    );
  }),
);

router.get(
  '/students/:id/transcript',
  asyncHandler(async (req, res) => {
    assertCanViewStudent(req, req.params.id);
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { user: { select: { firstName: true, lastName: true } }, programme: true },
    });
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id, status: { not: 'DROPPED' } },
      include: { course: { select: { code: true, title: true, creditHours: true } } },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }],
    });

    const terms = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      const key = `${e.academicYear} S${e.semester}`;
      terms.set(key, [...(terms.get(key) ?? []), e]);
    }
    const toRows = (list: typeof enrollments) =>
      list.map((e) => ({ gradePoint: e.gradePoint, creditHours: e.course.creditHours }));

    res.json({
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        name: `${student.user.firstName} ${student.user.lastName}`,
        programme: student.programme.name,
      },
      terms: [...terms.entries()].map(([term, list]) => ({
        term,
        gpa: computeGpa(toRows(list)),
        courses: list.map((e) => ({
          code: e.course.code,
          title: e.course.title,
          creditHours: e.course.creditHours,
          score: e.score,
          grade: e.grade,
          gradePoint: e.gradePoint,
          status: e.status,
        })),
      })),
      cgpa: computeGpa(toRows(enrollments)),
    });
  }),
);

// ---- Attendance ------------------------------------------------------------

router.post(
  '/attendance',
  requireRole('ADMIN', 'REGISTRAR', 'LECTURER'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        courseId: z.string().min(1),
        date: z.coerce.date(),
        records: z
          .array(z.object({ enrollmentId: z.string().min(1), status: z.nativeEnum(AttendanceStatus) }))
          .min(1)
          .max(500),
      })
      .parse(req.body);
    await assertCanManageCourse(req, body.courseId);

    const ids = body.records.map((r) => r.enrollmentId);
    const valid = await prisma.enrollment.count({ where: { id: { in: ids }, courseId: body.courseId } });
    if (valid !== new Set(ids).size) throw new HttpError(400, 'Some enrollments do not belong to this course');

    await prisma.$transaction(
      body.records.map((r) =>
        prisma.attendanceRecord.upsert({
          where: { enrollmentId_date: { enrollmentId: r.enrollmentId, date: body.date } },
          create: { enrollmentId: r.enrollmentId, date: body.date, status: r.status },
          update: { status: r.status },
        }),
      ),
    );
    res.json({ saved: body.records.length });
  }),
);

router.get(
  '/courses/:id/attendance',
  requireRole('ADMIN', 'REGISTRAR', 'LECTURER'),
  asyncHandler(async (req, res) => {
    await assertCanManageCourse(req, req.params.id);
    const q = z.object({ date: z.coerce.date().optional(), academicYear: academicYear.optional() }).parse(req.query);
    res.json(
      await prisma.attendanceRecord.findMany({
        where: { date: q.date, enrollment: { courseId: req.params.id, academicYear: q.academicYear } },
        include: {
          enrollment: {
            select: {
              id: true,
              student: { select: { studentNumber: true, user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
        orderBy: { date: 'desc' },
      }),
    );
  }),
);

router.get(
  '/students/:id/attendance',
  asyncHandler(async (req, res) => {
    assertCanViewStudent(req, req.params.id);
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: req.params.id, status: { not: 'DROPPED' } },
      include: { course: { select: { code: true, title: true } }, attendance: { select: { status: true } } },
    });
    res.json(
      enrollments.map((e) => {
        const total = e.attendance.length;
        const attended = e.attendance.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
        return {
          enrollmentId: e.id,
          course: e.course,
          academicYear: e.academicYear,
          semester: e.semester,
          sessions: total,
          attended,
          percentage: total ? Math.round((attended / total) * 1000) / 10 : null,
        };
      }),
    );
  }),
);

export default router;
