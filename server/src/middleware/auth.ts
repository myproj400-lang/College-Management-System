import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { HttpError } from './error';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  studentId: string | null;
  staffId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Verifies the bearer token, then reloads the user from the database so a
 * role change or deactivation takes effect immediately rather than when the
 * token expires.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }

    const user = await prisma.user.findUnique({
      where: { id: String(payload.sub) },
      include: { student: { select: { id: true } }, staff: { select: { id: true } } },
    });
    if (!user || !user.isActive) throw new HttpError(401, 'Account is inactive or no longer exists');

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      studentId: user.student?.id ?? null,
      staffId: user.staff?.id ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do this'));
    next();
  };
}
