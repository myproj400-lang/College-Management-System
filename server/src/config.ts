import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (process.env.NODE_ENV === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
