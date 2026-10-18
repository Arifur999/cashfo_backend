import { randomBytes } from 'node:crypto';

// A one-time password an admin hands over by hand: 16 URL-safe characters
// (96 random bits), shown once and never stored in the clear.
export const generateTempPassword = (): string => randomBytes(12).toString('base64url');
