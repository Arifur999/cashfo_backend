import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

type Db = Pick<Prisma.TransactionClient, 'user'>;

// A person's own shareable code (referral links, the profile card): eight
// upper-case hex characters, unique, made once and kept. The one place the
// algorithm lives, so sign-up, the Referral Program page and the profile card
// agree.
export const newReferralCode = (): string => randomBytes(5).toString('hex').toUpperCase().slice(0, 8);

// The person's code, made now when they have none (retrying on the
// astronomically rare clash).
export async function ensureReferralCode(db: Db, userId: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = newReferralCode();
    if (await db.user.findUnique({ where: { referralCode: candidate }, select: { id: true } })) continue;
    await db.user.update({ where: { id: userId }, data: { referralCode: candidate } });
    return candidate;
  }
  throw new Error('Could not generate a unique referral code');
}
