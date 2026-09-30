import { Router, Request } from 'express';
import bcrypt from 'bcryptjs';
import { StudentStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { email, name, pagination, paging, password } from '../lib/validation';

// Students and staff. Each is a User (for login) plus a profile record.
const router = Router();

const userSummary = { select: { id: true, email: true, firstName: true, lastName: true, isActive: true } } as const;

/** Office staff can see any student; a student can only see their own record. */
export function assertCanViewStudent(req: Request, studentId: string) {
  const u = req.user!;
  if (['ADMIN', 'REGISTRAR', 'BURSAR'].includes(u.role)) return;
  if (u.role === 'STUDENT' && u.studentId === studentId) return;
  throw new HttpError(403, 'You do not have permission to view this student');
}

// ---- Students --------------------------------------------------------------

const studentProfile = z.object({
  studentNumber: z.string().trim().min(3).max(30),
  programmeId: z.string().min(1),
  yearOfStudy: z.number().int().min(1).max(8).default(1),
  admissionDate: z.coerce.date().optional(),
  dateOfBirth: z.coerce.date().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
});

router.get(
  '/students',
  requireRole('ADMIN', 'REGISTRAR', 'BURSAR'),
  asyncHandler(async (req, res) => {
    const q = pagination
      .extend({
        programmeId: z.string().optional(),
        status: z.nativeEnum(StudentStatus).optional(),
        yearOfStudy: z.coerce.number().int().optional(),
        search: z.string().optional(),
      })
      .parse(req.query);
    const where = {
      programmeId: q.programmeId,
      status: q.status,
      yearOfStudy: q.yearOfStudy,
      ...(q.search && {
        OR: [
          { studentNumber: { contains: q.search, mode: 'insensitive' as const } },
          { user: { firstName: { contains: q.search, mode: 'insensitive' as const } } },
          { user: { lastName: { contains: q.search, mode: 'insensitive' as const } } },
          { user: { email: { contains: q.search, mode: 'insensitive' as const } } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: { user: userSummary, programme: { select: { id: true, code: true, name: true } } },
        orderBy: { studentNumber: 'asc' },
        ...paging(q),
      }),
      prisma.student.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

router.get(
  '/students/:id',
  asyncHandler(async (req, res) => {
    assertCanViewStudent(req, req.params.id);
    res.json(
      await prisma.student.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { user: userSummary, programme: { include: { department: true } } },
      }),
    );
  }),
);

router.post(
  '/students',
  requireRole('ADMIN', 'REGISTRAR'),
  asyncHandler(async (req, res) => {
    const body = studentProfile.extend({ email, password, firstName: name, lastName: name }).parse(req.body);
    const { email: e, password: p, firstName, lastName, ...profile } = body;
    const passwordHash = await bcrypt.hash(p, 12);
    const student = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: e, firstName, lastName, role: 'STUDENT', passwordHash } });
      return tx.student.create({
        data: { ...profile, userId: user.id },
        include: { user: userSummary, programme: { select: { id: true, code: true, name: true } } },
      });
    });
    res.status(201).json(student);
  }),
);

router.patch(
  '/students/:id',
  requireRole('ADMIN', 'REGISTRAR'),
  asyncHandler(async (req, res) => {
    const body = studentProfile
      .partial()
      .extend({ status: z.nativeEnum(StudentStatus).optional(), firstName: name.optional(), lastName: name.optional() })
      .parse(req.body);
    const { firstName, lastName, ...profile } = body;
    const student = await prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({ where: { id: req.params.id }, data: profile });
      if (firstName || lastName) {
        await tx.user.update({ where: { id: updated.userId }, data: { firstName, lastName } });
      }
      return tx.student.findUniqueOrThrow({
        where: { id: updated.id },
        include: { user: userSummary, programme: { select: { id: true, code: true, name: true } } },
      });
    });
    res.json(student);
  }),
);

// ---- Staff -----------------------------------------------------------------

const staffProfile = z.object({
  staffNumber: z.string().trim().min(3).max(30),
  position: z.string().trim().min(2).max(100),
  departmentId: z.string().min(1).nullable().optional(),
  phone: z.string().trim().max(30).optional(),
});

router.get(
  '/staff',
  requireRole('ADMIN', 'REGISTRAR'),
  asyncHandler(async (req, res) => {
    const q = z.object({ departmentId: z.string().optional() }).parse(req.query);
    res.json(
      await prisma.staff.findMany({
        where: { departmentId: q.departmentId },
        include: { user: userSummary, department: { select: { id: true, code: true, name: true } } },
        orderBy: { staffNumber: 'asc' },
      }),
    );
  }),
);

router.get(
  '/staff/:id',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    if (!['ADMIN', 'REGISTRAR'].includes(u.role) && u.staffId !== req.params.id) {
      throw new HttpError(403, 'You do not have permission to view this staff member');
    }
    res.json(
      await prisma.staff.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { user: userSummary, department: true, courses: { orderBy: { code: 'asc' } } },
      }),
    );
  }),
);

// Creates lecturer accounts with their staff profile.
router.post(
  '/staff',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const body = staffProfile.extend({ email, password, firstName: name, lastName: name }).parse(req.body);
    const { email: e, password: p, firstName, lastName, ...profile } = body;
    const passwordHash = await bcrypt.hash(p, 12);
    const staff = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: e, firstName, lastName, role: 'LECTURER', passwordHash } });
      return tx.staff.create({
        data: { ...profile, userId: user.id },
        include: { user: userSummary, department: { select: { id: true, code: true, name: true } } },
      });
    });
    res.status(201).json(staff);
  }),
);

router.patch(
  '/staff/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const body = staffProfile.partial().extend({ firstName: name.optional(), lastName: name.optional() }).parse(req.body);
    const { firstName, lastName, ...profile } = body;
    const staff = await prisma.$transaction(async (tx) => {
      const updated = await tx.staff.update({ where: { id: req.params.id }, data: profile });
      if (firstName || lastName) {
        await tx.user.update({ where: { id: updated.userId }, data: { firstName, lastName } });
      }
      return tx.staff.findUniqueOrThrow({
        where: { id: updated.id },
        include: { user: userSummary, department: { select: { id: true, code: true, name: true } } },
      });
    });
    res.json(staff);
  }),
);

export default router;
