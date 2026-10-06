import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { config } from '../config';
import { authenticate, signToken } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { email, name, password } from '../lib/validation';
import { deliverContactToken, hashToken, newContactToken } from '../lib/admissions/contactChannel';
import { audit } from '../lib/audit';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again in 15 minutes.' },
});

const REGISTERED_MESSAGE = 'If this address can be registered, complete the verification step for that contact channel.';

router.post(
  '/register-applicant',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ email, password, firstName: name, lastName: name }).parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (!existing || (existing.role === 'APPLICANT' && !existing.isActive)) {
      const token = newContactToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + config.contactVerificationTtlHours * 60 * 60 * 1000);
      const deliveryStatus = deliverContactToken(body.email, token);
      if (!existing) {
        const user = await prisma.user.create({
          data: {
            email: body.email,
            firstName: body.firstName,
            lastName: body.lastName,
            passwordHash: await bcrypt.hash(body.password, 12),
            role: 'APPLICANT',
            isActive: false,
            contactVerification: { create: { tokenHash, expiresAt, deliveryStatus } },
          },
        });
        await audit(prisma, user.id, 'applicant.register', 'User', user.id, { deliveryStatus });
      } else {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            firstName: body.firstName,
            lastName: body.lastName,
            passwordHash: await bcrypt.hash(body.password, 12),
            contactVerification: {
              upsert: {
                create: { tokenHash, expiresAt, deliveryStatus },
                update: { tokenHash, expiresAt, deliveryStatus, usedAt: null },
              },
            },
          },
        });
      }
    }
    res.status(202).json({ message: REGISTERED_MESSAGE });
  }),
);

router.post(
  '/verify-contact',
  asyncHandler(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const tokenHash = hashToken(body.token);
    const row = await prisma.contactVerification.findFirst({ where: { tokenHash, usedAt: null } });
    if (!row || row.expiresAt <= new Date()) {
      throw new HttpError(400, 'Verification failed');
    }
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.contactVerification.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new HttpError(400, 'Verification failed');
      await tx.user.update({ where: { id: row.userId }, data: { isActive: true } });
      await audit(tx, row.userId, 'applicant.verify', 'User', row.userId, {});
    });
    res.json({ message: 'Contact verified. You can sign in.' });
  }),
);

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
