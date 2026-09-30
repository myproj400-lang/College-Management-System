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

const contactChannel = process.env.CONTACT_CHANNEL ?? 'undelivered';
if (process.env.NODE_ENV === 'production' && contactChannel === 'capture') {
  throw new Error('CONTACT_CHANNEL=capture is a test double and cannot be used in production');
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  /// Proposed until the IT security owner approves recovery timings. Not a signed college rule.
  contactVerificationTtlHours: Number(process.env.CONTACT_VERIFICATION_TTL_HOURS ?? 24),
  /// `undelivered` keeps the token out of the API response. `capture` is for automated tests only.
  contactChannel,
  /// Hard cap. An intake may set a lower document limit, never a higher one.
  maxDocumentBytes: 1_500_000,
};
