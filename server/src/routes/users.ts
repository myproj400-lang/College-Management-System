import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { email, name, pagination, paging, password } from '../lib/validation';
import { audit } from '../lib/audit';

const router = Router();
router.use(requireRole('ADMIN'));

const publicUser = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = pagination.extend({ role: z.nativeEnum(Role).optional(), search: z.string().optional() }).parse(req.query);
    const where = {
      role: q.role,
      ...(q.search && {
        OR: [
          { email: { contains: q.search, mode: 'insensitive' as const } },
          { firstName: { contains: q.search, mode: 'insensitive' as const } },
          { lastName: { contains: q.search, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: publicUser, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      prisma.user.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

// Creates admin, registrar and bursar accounts. Students and lecturers are
// created through /students and /staff so their profile records exist too.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email,
        password,
        firstName: name,
        lastName: name,
        role: z.enum(['ADMIN', 'REGISTRAR', 'BURSAR']),
      })
      .parse(req.body);
    const { password: plain, ...rest } = body;
    const user = await prisma.user.create({
      data: { ...rest, passwordHash: await bcrypt.hash(plain, 12) },
      select: publicUser,
    });
    await audit(prisma, req.user!.id, 'user.create', 'User', user.id, { email: user.email, role: user.role });
    res.status(201).json(user);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        firstName: name.optional(),
        lastName: name.optional(),
        isActive: z.boolean().optional(),
        password: password.optional(),
      })
      .parse(req.body);
    if (req.params.id === req.user!.id && body.isActive === false) {
      throw new HttpError(400, 'You cannot deactivate your own account');
    }
    const { password: newPassword, ...rest } = body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...rest, ...(newPassword && { passwordHash: await bcrypt.hash(newPassword, 12) }) },
      select: publicUser,
    });
    // Never log the password itself — only that it was reset.
    await audit(prisma, req.user!.id, 'user.update', 'User', user.id, { ...rest, passwordReset: Boolean(newPassword) });
    res.json(user);
  }),
);

export default router;
