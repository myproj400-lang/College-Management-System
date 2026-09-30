import { z } from 'zod';

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const email = z.string().trim().toLowerCase().email();
export const name = z.string().trim().min(1).max(100);
export const academicYear = z.string().regex(/^\d{4}\/\d{4}$/, 'Use the format 2026/2027');
export const semester = z.coerce.number().int().min(1).max(3);

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function paging(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}
