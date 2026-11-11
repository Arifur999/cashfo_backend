import { ForbiddenException } from '@nestjs/common';
import { GroupEditorRules } from './group-editor-rules.js';

const setup = ({ role = 'ACCOUNTANT', createdBy = 'editor-user', paused = false, closed = false } = {}) => {
  const row = { createdByUserId: createdBy, date: new Date('2026-11-03'), settleGroupId: null };
  const prisma = {
    groupMember: { findFirst: vi.fn().mockResolvedValue({ id: 'gm-editor', role }) },
    groupContribution: { findFirst: vi.fn().mockResolvedValue(row), findMany: vi.fn().mockResolvedValue([row]) },
    groupExpense: { findFirst: vi.fn().mockResolvedValue(row) },
    groupCashHandover: { findFirst: vi.fn().mockResolvedValue(row) },
    groupSettings: { findUnique: vi.fn().mockResolvedValue({ pausedAt: paused ? new Date() : null }) },
    groupSettlement: { findFirst: vi.fn().mockResolvedValue(closed ? { id: 'closed' } : null) },
  };
  return { rules: new GroupEditorRules(prisma as never), prisma };
};

const deposit = (groupMemberId: string) => ({ groupMemberId, amount: '500', date: '2026-11-04' });

describe('GroupEditorRules', () => {
  it('lets an Editor add their own deposit, and nobody else’s', async () => {
    const { rules } = setup();
    await expect(rules.contribution('biz-1', 'editor-user', deposit('gm-editor'))).resolves.toBeUndefined();
    await expect(rules.contribution('biz-1', 'editor-user', deposit('gm-other'))).rejects.toThrow(/own name/);
    await expect(rules.contribution('biz-1', 'editor-user', { ...deposit('gm-editor'), kind: 'RETURN' })).rejects.toThrow(ForbiddenException);
  });

  it('keeps expenses, handovers and payments in their own name', async () => {
    const { rules } = setup();
    await expect(rules.expense('biz-1', 'editor-user', { amount: '200', date: '2026-11-04', paidByMemberId: 'gm-other' })).rejects.toThrow(/own name/);
    await expect(
      rules.handover('biz-1', 'editor-user', { fromMemberId: 'gm-other', toMemberId: 'gm-editor', amount: '100', date: '2026-11-04' }),
    ).rejects.toThrow(/own cash/);
    await expect(
      rules.settleUp('biz-1', 'editor-user', { fromMemberId: 'gm-other', toMemberId: 'gm-editor', amount: '100', date: '2026-11-04' }),
    ).rejects.toThrow(/you made/);
  });

  it('changes only the entries they added', async () => {
    const { rules } = setup({ createdBy: 'owner-user' });
    await expect(rules.expenseChange('biz-1', 'editor-user', 'x-1')).rejects.toThrow(/added yourself/);
    await expect(rules.contributionChange('biz-1', 'editor-user', 'c-1')).rejects.toThrow(/added yourself/);
    await expect(rules.handoverChange('biz-1', 'editor-user', 'h-1')).rejects.toThrow(/added yourself/);
    await expect(rules.settleUpUndo('biz-1', 'editor-user', 's-1')).rejects.toThrow(/added yourself/);
  });

  it('refuses a closed month and a paused group', async () => {
    await expect(
      setup({ closed: true }).rules.expense('biz-1', 'editor-user', { amount: '200', date: '2026-09-04', paidByMemberId: 'gm-editor' }),
    ).rejects.toThrow(/closed/);
    await expect(
      setup({ paused: true }).rules.expense('biz-1', 'editor-user', { amount: '200', date: '2026-11-04', paidByMemberId: 'gm-editor' }),
    ).rejects.toThrow(/paused/);
  });

  it('refuses a membership whose record is no longer an Editor', async () => {
    const { rules } = setup({ role: 'VIEWER' });
    await expect(rules.contribution('biz-1', 'editor-user', deposit('gm-editor'))).rejects.toThrow(ForbiddenException);
  });
});
