import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { academicYear, semester } from '../lib/validation';
import { audit } from '../lib/audit';

// Academic calendar: terms, registration windows, results publication.
const router = Router();
const canManage = requireRole('ADMIN', 'REGISTRAR');

const termBody = z
  .object({
    academicYear,
    semester,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    registrationOpensAt: z.coerce.date(),
    registrationClosesAt: z.coerce.date(),
    maxCredits: z.number().int().min(1).max(60).default(24),
  })
  .refine((t) => t.endDate > t.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })
  .refine((t) => t.registrationClosesAt > t.registrationOpensAt, {
    message: 'registrationClosesAt must be after registrationOpensAt',
    path: ['registrationClosesAt'],
  });

router.get(
  '/terms',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.academicTerm.findMany({ orderBy: [{ academicYear: 'desc' }, { semester: 'desc' }] }));
  }),
);

router.get(
  '/terms/current',
  asyncHandler(async (_req, res) => {
    const term = await prisma.academicTerm.findFirst({ where: { isCurrent: true } });
    if (!term) throw new HttpError(404, 'No current term has been set');
    res.json(term);
  }),
);

router.post(
  '/terms',
  canManage,
  asyncHandler(async (req, res) => {
    const term = await prisma.academicTerm.create({ data: termBody.parse(req.body) });
    await audit(prisma, req.user!.id, 'term.create', 'AcademicTerm', term.id, { academicYear: term.academicYear, semester: term.semester });
    res.status(201).json(term);
  }),
);

router.patch(
  '/terms/:id',
  canManage,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        registrationOpensAt: z.coerce.date(),
        registrationClosesAt: z.coerce.date(),
        maxCredits: z.number().int().min(1).max(60),
      })
      .partial()
      .parse(req.body);
    const merged = { ...(await prisma.academicTerm.findUniqueOrThrow({ where: { id: req.params.id } })), ...body };
    if (merged.endDate <= merged.startDate || merged.registrationClosesAt <= merged.registrationOpensAt) {
      throw new HttpError(400, 'Dates are out of order');
    }
    const term = await prisma.$transaction(async (tx) => {
      const t = await tx.academicTerm.update({ where: { id: req.params.id }, data: body });
      await audit(tx, req.user!.id, 'term.update', 'AcademicTerm', t.id, body);
      return t;
    });
    res.json(term);
  }),
);

router.post(
  '/terms/:id/set-current',
  canManage,
  asyncHandler(async (req, res) => {
    const term = await prisma.$transaction(async (tx) => {
      await tx.academicTerm.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      const t = await tx.academicTerm.update({ where: { id: req.params.id }, data: { isCurrent: true } });
      await audit(tx, req.user!.id, 'term.setCurrent', 'AcademicTerm', t.id);
      return t;
    });
    res.json(term);
  }),
);

// Publishing makes grades visible to students and locks them against lecturer edits.
router.post(
  '/terms/:id/publish-results',
  canManage,
  asyncHandler(async (req, res) => {
    const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: req.params.id } });
    if (term.resultsPublishedAt) throw new HttpError(400, 'Results for this term are already published');

    const ungraded = await prisma.enrollment.count({
      where: { academicYear: term.academicYear, semester: term.semester, status: 'ENROLLED' },
    });
    const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    if (ungraded > 0 && !force) {
      throw new HttpError(409, `${ungraded} enrollment(s) have no grade yet. Send {"force": true} to publish anyway.`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.academicTerm.update({ where: { id: term.id }, data: { resultsPublishedAt: new Date() } });
      await audit(tx, req.user!.id, 'term.publishResults', 'AcademicTerm', t.id, { ungraded });
      return t;
    });
    res.json(updated);
  }),
);

router.post(
  '/terms/:id/unpublish-results',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const term = await prisma.$transaction(async (tx) => {
      const t = await tx.academicTerm.update({ where: { id: req.params.id }, data: { resultsPublishedAt: null } });
      await audit(tx, req.user!.id, 'term.unpublishResults', 'AcademicTerm', t.id);
      return t;
    });
    res.json(term);
  }),
);

export default router;
