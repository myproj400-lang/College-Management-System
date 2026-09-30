import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

// Departments, programmes and courses: any signed-in user can read them;
// only admins and registrars can change them.
const router = Router();
const canManage = requireRole('ADMIN', 'REGISTRAR');

const code = z.string().trim().toUpperCase().min(2).max(20);
const title = z.string().trim().min(2).max(200);

// ---- Departments -----------------------------------------------------------

const departmentBody = z.object({ code, name: title });

router.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.department.findMany({ orderBy: { name: 'asc' } }));
  }),
);

router.get(
  '/departments/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.department.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { programmes: true, courses: true },
      }),
    );
  }),
);

router.post(
  '/departments',
  canManage,
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.department.create({ data: departmentBody.parse(req.body) }));
  }),
);

router.patch(
  '/departments/:id',
  canManage,
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.department.update({ where: { id: req.params.id }, data: departmentBody.partial().parse(req.body) }),
    );
  }),
);

router.delete(
  '/departments/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.department.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---- Programmes ------------------------------------------------------------

const programmeBody = z.object({
  code,
  name: title,
  level: z.string().trim().min(2).max(50),
  durationYears: z.number().int().min(1).max(8),
  departmentId: z.string().min(1),
});

router.get(
  '/programmes',
  asyncHandler(async (req, res) => {
    const q = z.object({ departmentId: z.string().optional() }).parse(req.query);
    res.json(
      await prisma.programme.findMany({
        where: { departmentId: q.departmentId },
        include: { department: { select: { id: true, code: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }),
);

router.get(
  '/programmes/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.programme.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { department: true, courses: { orderBy: { code: 'asc' } } },
      }),
    );
  }),
);

router.post(
  '/programmes',
  canManage,
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.programme.create({ data: programmeBody.parse(req.body) }));
  }),
);

router.patch(
  '/programmes/:id',
  canManage,
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.programme.update({ where: { id: req.params.id }, data: programmeBody.partial().parse(req.body) }),
    );
  }),
);

router.delete(
  '/programmes/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.programme.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---- Courses ---------------------------------------------------------------

const courseBody = z.object({
  code,
  title,
  creditHours: z.number().int().min(1).max(12),
  semester: z.number().int().min(1).max(3),
  departmentId: z.string().min(1),
  programmeId: z.string().min(1).nullable().optional(),
  lecturerId: z.string().min(1).nullable().optional(),
});

router.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        departmentId: z.string().optional(),
        programmeId: z.string().optional(),
        lecturerId: z.string().optional(),
        semester: z.coerce.number().int().optional(),
      })
      .parse(req.query);
    res.json(
      await prisma.course.findMany({
        where: q,
        include: {
          department: { select: { id: true, code: true, name: true } },
          lecturer: { select: { id: true, staffNumber: true, user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { code: 'asc' },
      }),
    );
  }),
);

router.get(
  '/courses/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.course.findUniqueOrThrow({
        where: { id: req.params.id },
        include: {
          department: true,
          programme: true,
          lecturer: { select: { id: true, staffNumber: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
    );
  }),
);

router.post(
  '/courses',
  canManage,
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.course.create({ data: courseBody.parse(req.body) }));
  }),
);

router.patch(
  '/courses/:id',
  canManage,
  asyncHandler(async (req, res) => {
    res.json(await prisma.course.update({ where: { id: req.params.id }, data: courseBody.partial().parse(req.body) }));
  }),
);

router.delete(
  '/courses/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.course.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
