// What a vault password must be, checked on set and on reset (the setup
// screen ticks the same four rules as you type): at least 8 characters,
// letters and numbers, not the person's name, and -- checked by the service,
// which can see the account password -- not the account password.

export const VAULT_PASSWORD_MIN_LENGTH = 8;
export const VAULT_PASSWORD_MAX_LENGTH = 128;

export type VaultPasswordProblem = 'VAULT_PASSWORD_WEAK' | 'VAULT_PASSWORD_HAS_NAME' | 'VAULT_PASSWORD_IS_ACCOUNT_PASSWORD';

export const VAULT_PASSWORD_MESSAGES: Record<VaultPasswordProblem, string> = {
  VAULT_PASSWORD_WEAK: `Use at least ${VAULT_PASSWORD_MIN_LENGTH} characters with both letters and numbers.`,
  VAULT_PASSWORD_HAS_NAME: 'Your vault password should not contain your name.',
  VAULT_PASSWORD_IS_ACCOUNT_PASSWORD: 'Your vault password must be different from the password you log in with.',
};

// The parts of a name worth refusing: each run of letters, three or more
// long ("Md" and "Al" would refuse too many ordinary passwords).
export function nameParts(name: string | null | undefined): string[] {
  return [...new Set((name ?? '').toLocaleLowerCase().match(/\p{L}{3,}/gu) ?? [])];
}

// The first rule the password breaks, apart from the account-password one,
// or null.
export function vaultPasswordProblem(
  password: string,
  name: string | null | undefined,
): Exclude<VaultPasswordProblem, 'VAULT_PASSWORD_IS_ACCOUNT_PASSWORD'> | null {
  if (password.length < VAULT_PASSWORD_MIN_LENGTH || password.length > VAULT_PASSWORD_MAX_LENGTH || !/\p{L}/u.test(password) || !/\d/.test(password)) {
    return 'VAULT_PASSWORD_WEAK';
  }
  const lower = password.toLocaleLowerCase();
  if (nameParts(name).some((part) => lower.includes(part))) return 'VAULT_PASSWORD_HAS_NAME';
  return null;
}
