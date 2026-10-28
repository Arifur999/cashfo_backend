// Admin > Settings "Allow new sign-ups" (the signups_open PlatformSetting).
// Read straight from the table, not through SettingsService, because
// better-auth's user hook has only the bare Prisma client.

export const SIGNUPS_CLOSED_MESSAGE = 'New sign-ups are closed for now.';
// The machine-readable reason: the register 403 carries it, and a refused
// Google sign-up redirects to the frontend's error page with ?error=signups_closed.
export const SIGNUPS_CLOSED_REASON = 'SIGNUPS_CLOSED';
export const SIGNUPS_CLOSED_OAUTH_CODE = 'signups_closed';

// Only an explicit false closes sign-ups: a missing or odd value keeps the
// default (open), so a bad row can never lock everyone out by accident.
export const signupsOpenFrom = (value: unknown): boolean => value !== false;

interface SettingReader {
  platformSetting: { findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null> };
}

export async function areSignupsOpen(prisma: SettingReader): Promise<boolean> {
  const row = await prisma.platformSetting.findUnique({ where: { key: 'signups_open' }, select: { value: true } });
  return signupsOpenFrom(row?.value);
}
