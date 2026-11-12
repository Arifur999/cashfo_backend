import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateGroupExpenseCategoryDto } from './dto/create-group-expense-category.dto.js';
import { UpdateGroupSettingsDto } from './dto/group-settings.dto.js';
import { ReorderGroupCategoriesDto } from './dto/reorder-group-categories.dto.js';
import { SettleUpDto } from './dto/settle-up.dto.js';
import { groupMonthKey } from './group-expenses.service.js';

const ok = <T extends object>(cls: new () => T, body: object) => validateSync(plainToInstance(cls, body) as object).length === 0;
const category = (extra: object) => ({ name: 'Rent', color: 'blue', ...extra });
const settle = (extra: object) => ({ fromMemberId: 'a', toMemberId: 'b', amount: '100', date: '2026-11-12', ...extra });

describe('group v16 gaps', () => {
  it('takes a monthly limit on a category, or null for none', () => {
    expect(ok(CreateGroupExpenseCategoryDto, category({ monthlyLimit: 5000 }))).toBe(true);
    expect(ok(CreateGroupExpenseCategoryDto, category({ monthlyLimit: null }))).toBe(true);
    expect(ok(CreateGroupExpenseCategoryDto, category({}))).toBe(true);
    expect(ok(CreateGroupExpenseCategoryDto, category({ monthlyLimit: 0 }))).toBe(false);
    expect(ok(CreateGroupExpenseCategoryDto, category({ monthlyLimit: 12.345 }))).toBe(false);
    expect(ok(CreateGroupExpenseCategoryDto, category({ monthlyLimit: '5000' }))).toBe(false);
  });

  it('takes how new categories are shared and a first month', () => {
    expect(ok(UpdateGroupSettingsDto, { newCategorySplit: 'SHARES' })).toBe(true);
    expect(ok(UpdateGroupSettingsDto, { newCategorySplit: 'HALF' })).toBe(false);
    expect(ok(UpdateGroupSettingsDto, { firstMonth: '2026-04' })).toBe(true);
    expect(ok(UpdateGroupSettingsDto, { firstMonth: null })).toBe(true);
    expect(ok(UpdateGroupSettingsDto, { firstMonth: '2026-13' })).toBe(false);
    expect(ok(UpdateGroupSettingsDto, { firstMonth: '2026-4' })).toBe(false);
  });

  it('takes how a settle-up was paid, or nothing', () => {
    expect(ok(SettleUpDto, settle({ method: 'BKASH' }))).toBe(true);
    expect(ok(SettleUpDto, settle({}))).toBe(true);
    expect(ok(SettleUpDto, settle({ method: 'CHEQUE' }))).toBe(false);
  });

  it('takes a list of category ids to reorder', () => {
    expect(ok(ReorderGroupCategoriesDto, { ids: ['3f2b8c1e-1d2a-4b6c-9e0f-112233445566'] })).toBe(true);
    expect(ok(ReorderGroupCategoriesDto, { ids: [] })).toBe(false);
    expect(ok(ReorderGroupCategoriesDto, { ids: ['nope'] })).toBe(false);
  });

  it('puts a day in its group month by the start day', () => {
    expect(groupMonthKey(new Date('2026-10-05T00:00:00Z'), 1)).toBe('2026-10');
    expect(groupMonthKey(new Date('2026-10-05T00:00:00Z'), 10)).toBe('2026-09');
    expect(groupMonthKey(new Date('2026-10-10T00:00:00Z'), 10)).toBe('2026-10');
    expect(groupMonthKey(new Date('2026-01-03T00:00:00Z'), 5)).toBe('2025-12');
  });
});
