import { createHash, randomBytes } from 'node:crypto';
import { config } from '../../config';

/**
 * Test double only. Automated tests read a token from here when
 * CONTACT_CHANNEL=capture. Production must not enable that channel.
 * No email provider is selected, so the default channel delivers nothing.
 */
export const capturedContacts: { email: string; token: string }[] = [];

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newContactToken(): string {
  return randomBytes(32).toString('hex');
}

/** Returns the delivery status to store. Never returns the token to the caller. */
export function deliverContactToken(email: string, token: string): 'UNDELIVERED' | 'CAPTURED' {
  if (config.contactChannel === 'capture') {
    capturedContacts.push({ email, token });
    return 'CAPTURED';
  }
  return 'UNDELIVERED';
}
