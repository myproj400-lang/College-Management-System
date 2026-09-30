import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

// Notices from college offices, optionally aimed at one role and/or programme.
const router = Router();
const canPost = requireRole('ADMIN', 'REGISTRAR', 'BURSAR');

const body = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10_000),
  audience: z.nativeEnum(Role).nullable().optional(),
  programmeId: z.string().min(1).nullable().optional(),
  publishedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

const withAuthor = { createdBy: { select: { firstName: true, lastName: true, role: true } } };

// What the signed-in user should see right now.
router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const now = new Date();
    const programmeId = u.studentId
      ? (await prisma.student.findUnique({ where: { id: u.studentId }, select: { programmeId: true } }))?.programmeId
      : undefined;

    res.json(
      await prisma.announcement.findMany({
        where: {
          publishedAt: { lte: now },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            { OR: [{ audience: null }, { audience: u.role }] },
            { OR: [{ programmeId: null }, ...(programmeId ? [{ programmeId }] : [])] },
          ],
        },
        include: withAuthor,
        orderBy: { publishedAt: 'desc' },
        take: 100,
      }),
    );
  }),
);

// Everything, including scheduled and expired notices, for the offices that manage them.
router.get(
  '/announcements/all',
  canPost,
  asyncHandler(async (_req, res) => {
    res.json(await prisma.announcement.findMany({ include: withAuthor, orderBy: { publishedAt: 'desc' } }));
  }),
);

router.post(
  '/announcements',
  canPost,
  asyncHandler(async (req, res) => {
    const data = body.parse(req.body);
    res.status(201).json(await prisma.announcement.create({ data: { ...data, createdById: req.user!.id } }));
  }),
);

router.patch(
  '/announcements/:id',
  canPost,
  asyncHandler(async (req, res) => {
    res.json(await prisma.announcement.update({ where: { id: req.params.id }, data: body.partial().parse(req.body) }));
  }),
);

router.delete(
  '/announcements/:id',
  canPost,
  asyncHandler(async (req, res) => {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
