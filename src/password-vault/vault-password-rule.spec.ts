import { nameParts, vaultPasswordProblem } from './vault-password-rule.js';

describe('vaultPasswordProblem', () => {
  it('asks for 8+ characters with letters and numbers', () => {
    expect(vaultPasswordProblem('abc123', 'Khaled Mahmud')).toBe('VAULT_PASSWORD_WEAK');
    expect(vaultPasswordProblem('abcdefgh', 'Khaled Mahmud')).toBe('VAULT_PASSWORD_WEAK');
    expect(vaultPasswordProblem('12345678', 'Khaled Mahmud')).toBe('VAULT_PASSWORD_WEAK');
    expect(vaultPasswordProblem('x'.repeat(128) + '1', 'Khaled')).toBe('VAULT_PASSWORD_WEAK');
    expect(vaultPasswordProblem('river stone 42', 'Khaled Mahmud')).toBeNull();
  });

  it('counts Bangla letters as letters', () => {
    expect(vaultPasswordProblem('নদীপাথর৪২ab1', null)).toBeNull();
  });

  it('refuses any 3+ letter part of the name, whatever the case', () => {
    expect(vaultPasswordProblem('KHALED2026!', 'Khaled Mahmud')).toBe('VAULT_PASSWORD_HAS_NAME');
    expect(vaultPasswordProblem('my-mahmud-99', 'Khaled Mahmud')).toBe('VAULT_PASSWORD_HAS_NAME');
    // "Md" is too short to count.
    expect(vaultPasswordProblem('mdriver2026', 'Md. Rahim')).toBeNull();
  });

  it('splits names on anything but letters', () => {
    expect(nameParts('Md. Abdur-Rahim  Khan')).toEqual(['abdur', 'rahim', 'khan']);
    expect(nameParts('')).toEqual([]);
    expect(nameParts(null)).toEqual([]);
  });
});
