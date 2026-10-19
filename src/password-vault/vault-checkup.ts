// The security checkup's rules, run on the server so only entry ids ever
// leave it -- never a password. Pure, so it is tested on its own.

// A password counts as old once it is a year old.
export const OLD_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

const COMMON = ['password', 'passw0rd', 'qwerty', 'asdfgh', 'letmein', 'iloveyou', 'welcome', 'admin', 'abc123', 'bangladesh'];
const RUNS = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

// Four characters in a row of a run, forwards or backwards: 1234, dcba, qwer.
function hasRun(lower: string): boolean {
  for (const run of RUNS) {
    for (const line of [run, [...run].reverse().join('')]) {
      for (let i = 0; i + 4 <= line.length; i++) if (lower.includes(line.slice(i, i + 4))) return true;
    }
  }
  return false;
}

// Weak: what the browser's meter calls Weak or Too short (under 8
// characters, or only one kind of character), or built on a common word, a
// run like 1234, one character four times over, or the person's own name or
// phone number.
export function isWeakPassword(password: string, person: { name: string; phone: string | null }): boolean {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length;
  if (password.length < 8 || kinds < 2) return true;
  const lower = password.toLowerCase();
  if (COMMON.some((word) => lower.includes(word)) || hasRun(lower) || /(.)\1{3,}/.test(password)) return true;
  const names = person.name.toLowerCase().split(/\s+/).filter((part) => part.length >= 3);
  if (names.some((part) => lower.includes(part))) return true;
  const digits = person.phone?.replace(/\D/g, '') ?? '';
  return digits.length >= 6 && password.replace(/\D/g, '').includes(digits.slice(-6));
}

export interface CheckupEntry {
  id: string;
  password: string;
  passwordChangedAt: Date;
  // "It's fine": the warnings stay hidden until the password changes again.
  checkupDismissedAt: Date | null;
}

export interface Checkup {
  weak: string[];
  reused: string[];
  old: string[];
}

export function securityCheckup(entries: CheckupEntry[], person: { name: string; phone: string | null }, now: Date): Checkup {
  const uses = new Map<string, number>();
  for (const entry of entries) uses.set(entry.password, (uses.get(entry.password) ?? 0) + 1);
  const open = entries.filter((entry) => !entry.checkupDismissedAt || entry.checkupDismissedAt < entry.passwordChangedAt);
  return {
    weak: open.filter((entry) => isWeakPassword(entry.password, person)).map((entry) => entry.id),
    reused: open.filter((entry) => (uses.get(entry.password) ?? 0) > 1).map((entry) => entry.id),
    old: open.filter((entry) => now.getTime() - entry.passwordChangedAt.getTime() > OLD_AFTER_MS).map((entry) => entry.id),
  };
}
