import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, signToken } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { email, password } from '../lib/validation';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ email, password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Same message for unknown email and wrong password, so accounts can't be enumerated.
    const ok = user && user.isActive && (await bcrypt.compare(body.password, user.passwordHash));
    if (!ok) throw new HttpError(401, 'Invalid email or password');

    res.json({
      token: signToken(user.id),
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        student: { include: { programme: true } },
        staff: { include: { department: true } },
      },
    });
    res.json(user);
  }),
);

router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: password }).parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 12) },
    });
    res.json({ message: 'Password changed' });
  }),
);

export default router;
