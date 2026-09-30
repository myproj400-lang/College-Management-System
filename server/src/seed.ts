import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './db';

/** Creates the first admin account so someone can sign in and set up the rest. */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists — nothing to do.`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      firstName: 'System',
      lastName: 'Administrator',
      role: 'ADMIN',
    },
  });
  console.log(`Created admin ${email}. Sign in and change the password.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
