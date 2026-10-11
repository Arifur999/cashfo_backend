import * as bcrypt from 'bcrypt';

// Account passwords stay bcrypt -- every hash already stored is one -- and
// better-auth is configured with these same two functions instead of its
// scrypt default, so the app and better-auth write and accept one format.
const BCRYPT_ROUNDS = 10;

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, BCRYPT_ROUNDS);

export const verifyPassword = (password: string, hash: string): Promise<boolean> => bcrypt.compare(password, hash);
