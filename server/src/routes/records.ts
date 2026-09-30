import { Router, Request } from 'express';
import { AttendanceStatus, EnrollmentStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { academicYear, semester } from '../lib/validation';
import { academicStanding, combineScore, computeGpa, gradeFor, PASS_GRADE_POINT } from '../lib/grading';
import { audit } from '../lib/audit';
import { findTerm, overdueBalance, publishedTermKeys, registrationOpen, termKey } from '../lib/terms';
import { assertCanViewStudent } from './people';

/** Blanks out marks a student isn't allowed to see yet (results not published). */
function hideMarks<T extends object>(e: T): T {
  return { ...e, courseworkScore: null, examScore: null, score: null, grade: null, gradePoint: null } as T;
}

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

    const rows = await prisma.enrollment.findMany({
      where: q,
      include: {
        course: { select: { id: true, code: true, title: true, creditHours: true } },
        student: {
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: [{ academicYear: 'desc' }, { semester: 'desc' }],
    });
    if (u.role !== 'STUDENT') return res.json(rows);
    const published = await publishedTermKeys(prisma);
    res.json(rows.map((e) => (published.has(termKey(e.academicYear, e.semester)) ? e : hideMarks(e))));
  }),
);

/**
 * Registration rules:
 * - the term must exist; students may only register while its registration window is open
 * - the student must be ACTIVE, and students with overdue fees can't self-register
 * - every prerequisite must already be passed
 * - total credits for the term can't exceed the term's maxCredits
 * Admins and registrars can bypass the prerequisite, credit and fee checks with
 * `override: true`; the override is recorded in the audit log.
 */
router.post(
  '/enrollments',
  requireRole('ADMIN', 'REGISTRAR', 'STUDENT'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        studentId: z.string().min(1),
        courseId: z.string().min(1),
        academicYear,
        semester,
        override: z.boolean().default(false),
      })
      .parse(req.body);
    const u = req.user!;
    const isStudent = u.role === 'STUDENT';
    if (isStudent && u.studentId !== body.studentId) throw new HttpError(403, 'Students can only register themselves');
    if (isStudent && body.override) throw new HttpError(403, 'Only the registry can override registration rules');

    const { override, ...data } = body;
    const term = await findTerm(prisma, data.academicYear, data.semester);
    if (isStudent && !registrationOpen(term)) throw new HttpError(400, 'Registration for this term is closed');

    const student = await prisma.student.findUniqueOrThrow({ where: { id: data.studentId } });
    if (student.status !== 'ACTIVE') throw new HttpError(400, `Student is ${student.status.toLowerCase()}`);

    const course = await prisma.course.findUniqueOrThrow({
      where: { id: data.courseId },
      include: { prerequisites: { include: { prerequisite: { select: { id: true, code: true } } } } },
    });

    // A dropped course can be taken up again in the same term; anything else is a duplicate.
    const existing = await prisma.enrollment.findUnique({
      where: { studentId_courseId_academicYear_semester: data },
    });
    if (existing && existing.status !== 'DROPPED') {
      throw new HttpError(409, `Already registered for ${course.code} this term`);
    }

    const problems: string[] = [];

    const owed = await overdueBalance(prisma, student.id);
    if (owed.greaterThan(0)) problems.push(`Student has overdue fees of ${owed.toFixed(2)}`);

    if (course.prerequisites.length) {
      const passed = await prisma.enrollment.findMany({
        where: {
          studentId: student.id,
          courseId: { in: course.prerequisites.map((p) => p.prerequisiteId) },
          status: 'COMPLETED',
          gradePoint: { gte: PASS_GRADE_POINT },
        },
        select: { courseId: true },
      });
      const passedIds = new Set(passed.map((p) => p.courseId));
      const missing = course.prerequisites.filter((p) => !passedIds.has(p.prerequisiteId)).map((p) => p.prerequisite.code);
      if (missing.length) problems.push(`Prerequisites not passed: ${missing.join(', ')}`);
    }

    const current = await prisma.enrollment.findMany({
      where: { studentId: student.id, academicYear: data.academicYear, semester: data.semester, status: { not: 'DROPPED' } },
      select: { course: { select: { creditHours: true } } },
    });
    const credits = current.reduce((sum, e) => sum + e.course.creditHours, 0) + course.creditHours;
    if (credits > term.maxCredits) problems.push(`Credit limit exceeded: ${credits} of ${term.maxCredits} allowed`);

    if (problems.length && !override) throw new HttpError(400, problems.join('. '));

    const enrollment = await prisma.$transaction(async (tx) => {
      const e = existing
        ? await tx.enrollment.update({ where: { id: existing.id }, data: { status: 'ENROLLED' }, include: { course: true } })
        : await tx.enrollment.create({ data, include: { course: true } });
      await audit(tx, u.id, 'enrollment.create', 'Enrollment', e.id, {
        studentId: data.studentId,
        course: course.code,
        ...(existing && { reRegisteredAfterDrop: true }),
        ...(problems.length && { overridden: problems }),
      });
      return e;
    });
    res.status(201).json(enrollment);
  }),
);

// Registry can set any status; a student can only drop their own course while registration is open.
router.patch(
  '/enrollments/:id/status',
  requireRole('ADMIN', 'REGISTRAR', 'STUDENT'),
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.nativeEnum(EnrollmentStatus) }).parse(req.body);
    const u = req.user!;
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: req.params.id } });

    if (u.role === 'STUDENT') {
      if (enrollment.studentId !== u.studentId) throw new HttpError(403, 'This is not your enrollment');
      if (status !== 'DROPPED') throw new HttpError(403, 'Students can only drop a course');
      if (enrollment.status !== 'ENROLLED') throw new HttpError(400, 'Only an active enrollment can be dropped');
      const term = await findTerm(prisma, enrollment.academicYear, enrollment.semester);
      if (!registrationOpen(term)) throw new HttpError(400, 'The add/drop period for this term is closed');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const e = await tx.enrollment.update({ where: { id: enrollment.id }, data: { status } });
      await audit(tx, u.id, 'enrollment.status', 'Enrollment', e.id, { from: enrollment.status, to: status });
      return e;
    });
    res.json(updated);
  }),
);

// ---- Grades ----------------------------------------------------------------

/**
 * Accepts either a final `score`, or `courseworkScore` + `examScore` (each out
 * of 100) which are combined using the course's coursework weight. Once a
 * term's results are published only admins and registrars can change grades.
 */
router.put(
  '/enrollments/:id/grade',
  requireRole('ADMIN', 'REGISTRAR', 'LECTURER'),
  asyncHandler(async (req, res) => {
    const mark = z.number().min(0).max(100);
    const body = z
      .union([
        z.object({ courseworkScore: mark, examScore: mark }).strict(),
        z.object({ score: mark }).strict(),
      ])
      .parse(req.body);

    const enrollment = await prisma.enrollment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { course: { select: { courseworkWeight: true } } },
    });
    await assertCanManageCourse(req, enrollment.courseId);
    if (enrollment.status === 'DROPPED') throw new HttpError(400, 'Cannot grade a dropped course');

    const term = await prisma.academicTerm.findUnique({
      where: { academicYear_semester: { academicYear: enrollment.academicYear, semester: enrollment.semester } },
    });
    if (term?.resultsPublishedAt && !isOffice(req)) {
      throw new HttpError(403, 'Results for this term are published; ask the registry to amend the grade');
    }

    const components =
      'examScore' in body
        ? { courseworkScore: body.courseworkScore, examScore: body.examScore }
        : { courseworkScore: null, examScore: null };
    const score =
      'examScore' in body
        ? combineScore(body.courseworkScore, body.examScore, enrollment.course.courseworkWeight)
        : body.score;

    const updated = await prisma.$transaction(async (tx) => {
      const e = await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { ...components, score, ...gradeFor(score), status: 'COMPLETED' },
      });
      await audit(tx, req.user!.id, 'grade.set', 'Enrollment', e.id, {
        from: enrollment.score === null ? null : { score: enrollment.score, grade: enrollment.grade },
        to: { ...components, score, grade: e.grade },
        afterPublication: Boolean(term?.resultsPublishedAt),
      });
      return e;
    });
    res.json(updated);
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
    const all = await prisma.enrollment.findMany({
      where: { studentId: student.id, status: { not: 'DROPPED' } },
      include: { course: { select: { code: true, title: true, creditHours: true } } },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }],
    });
    // Students only see terms whose results have been published.
    const published = await publishedTermKeys(prisma);
    const enrollments =
      req.user!.role === 'STUDENT' ? all.filter((e) => published.has(termKey(e.academicYear, e.semester))) : all;

    const terms = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      const key = `${e.academicYear} S${e.semester}`;
      terms.set(key, [...(terms.get(key) ?? []), e]);
    }
    const toRows = (list: typeof enrollments) =>
      list.map((e) => ({ gradePoint: e.gradePoint, creditHours: e.course.creditHours }));
    const cgpa = computeGpa(toRows(enrollments));

    res.json({
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        name: `${student.user.firstName} ${student.user.lastName}`,
        programme: student.programme.name,
      },
      terms: [...terms.entries()].map(([term, list]) => ({
        term,
        resultsPublished: published.has(termKey(list[0].academicYear, list[0].semester)),
        credits: list.reduce((sum, e) => sum + e.course.creditHours, 0),
        gpa: computeGpa(toRows(list)),
        courses: list.map((e) => ({
          code: e.course.code,
          title: e.course.title,
          creditHours: e.course.creditHours,
          courseworkScore: e.courseworkScore,
          examScore: e.examScore,
          score: e.score,
          grade: e.grade,
          gradePoint: e.gradePoint,
          status: e.status,
        })),
      })),
      cgpa,
      standing: academicStanding(cgpa),
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
