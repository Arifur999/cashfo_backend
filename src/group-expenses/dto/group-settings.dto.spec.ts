import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateGroupSettingsDto } from './group-settings.dto.js';

const ok = (kind: unknown) => validateSync(plainToInstance(UpdateGroupSettingsDto, { kind })).length === 0;

describe('UpdateGroupSettingsDto kind', () => {
  it('takes a family, a mess, a trip and an office (the v16 New group picker)', () => {
    for (const kind of ['FAMILY', 'MESS', 'TRIP', 'OFFICE']) expect(ok(kind)).toBe(true);
  });

  it('refuses any other kind', () => {
    expect(ok('HOUSE')).toBe(false);
    expect(ok('trip')).toBe(false);
    expect(ok(3)).toBe(false);
  });
});
