import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RestoreAvatarDto } from './restore-avatar.dto.js';

const ok = (url: unknown) => validateSync(plainToInstance(RestoreAvatarDto, { url })).length === 0;

describe('RestoreAvatarDto', () => {
  it('takes our own uploads and Google sign-in photos', () => {
    expect(ok('https://i.ibb.co/abc123/photo.jpg')).toBe(true);
    expect(ok('https://lh3.googleusercontent.com/a/ACg8ocK=s96-c')).toBe(true);
  });

  it('refuses any other place, plain http and lookalike hosts', () => {
    expect(ok('https://example.com/me.png')).toBe(false);
    expect(ok('http://i.ibb.co/abc123/photo.jpg')).toBe(false);
    expect(ok('https://i.ibb.co.evil.com/x.png')).toBe(false);
    expect(ok('https://googleusercontent.com.evil.com/x.png')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok(42)).toBe(false);
  });
});
