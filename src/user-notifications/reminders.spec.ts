import { describe, expect, it } from 'vitest';
import { announcementReminders, budgetReminders, categoryNamesBn, loanReminders, savingsReminders, zakatReminders } from './reminders.js';

describe('budgetReminders', () => {
  it('reminds once past 90% of a limit and again once over it', () => {
    const drafts = budgetReminders('b1', '2026-10', [
      { id: 'shop', name: 'Shopping', monthlyLimit: '5000.00', spent: '4900.00' },
      { id: 'food', name: 'Food', monthlyLimit: '8000.00', spent: '8400.00' },
      { id: 'rent', name: 'Rent', monthlyLimit: '15000.00', spent: '12000.00' },
      { id: 'misc', name: 'Misc', monthlyLimit: null, spent: '700.00' },
    ]);
    expect(drafts.map((d) => d.key)).toEqual(['budget:shop:2026-10:90', 'budget:food:2026-10:over']);
    expect(drafts[0].data).toEqual({ category: 'Shopping', categoryBn: null, percent: 98, left: '100.00', month: '2026-10' });
    expect(drafts[1].data.left).toBe('-400.00');
  });

  it('names the category in Bangla too when it has a Bangla name, under the same key', () => {
    const [draft] = budgetReminders('b1', '2026-10', [{ id: 'shop', name: 'Shopping', nameBn: 'কেনাকাটা', monthlyLimit: '5000.00', spent: '4900.00' }]);
    expect(draft.key).toBe('budget:shop:2026-10:90');
    expect(draft.data).toEqual({ category: 'Shopping', categoryBn: 'কেনাকাটা', percent: 98, left: '100.00', month: '2026-10' });
  });
});

describe('categoryNamesBn', () => {
  const nameBnOf = categoryNamesBn([
    { name: 'Shopping', nameBn: 'কেনাকাটা' },
    { name: 'Food', nameBn: 'খাবার' },
    // An inactive one of the same name comes after the active one.
    { name: 'food', nameBn: 'খাদ্য' },
    { name: 'Rent', nameBn: '  ' },
  ]);

  it("gives a category the Bangla name of the default category it's named after, case and spaces aside", () => {
    expect(nameBnOf('Shopping')).toBe('কেনাকাটা');
    expect(nameBnOf(' shopping ')).toBe('কেনাকাটা');
    expect(nameBnOf('FOOD')).toBe('খাবার');
  });

  it('has none for a name of its own, or where the default has a blank one', () => {
    expect(nameBnOf('Tea stall')).toBeNull();
    expect(nameBnOf('Rent')).toBeNull();
    expect(categoryNamesBn([])('Shopping')).toBeNull();
  });
});

describe('loanReminders', () => {
  it('keys each reminder by the entry and its due date', () => {
    const [draft] = loanReminders('b1', [
      { transactionId: 't1', contactId: 'c1', contactName: 'Islami Bank', contactCategory: 'LOAN', direction: 'PAYABLE', remainingAmount: '5000.00', dueDate: new Date('2026-10-05T00:00:00.000Z'), daysUntilDue: 3 },
    ]);
    expect(draft.key).toBe('loan:t1:2026-10-05');
    expect(draft.data).toEqual({ name: 'Islami Bank', contactId: 'c1', loan: 1, direction: 'PAYABLE', amount: '5000.00', dueDate: '2026-10-05', days: 3 });
  });
});

describe('savingsReminders', () => {
  const today = new Date('2026-10-02T00:00:00.000Z');
  const goal = { id: 'g1', name: 'iPhone', targetAmount: '150000.00', currentAmount: '48750.00', targetDate: new Date('2027-01-31T00:00:00.000Z'), progressPercent: 33, paceStatus: 'BEHIND' as const };

  it('spreads what is left over the months to the target date', () => {
    const [draft] = savingsReminders('b1', '2026-10', today, [goal]);
    expect(draft.key).toBe('savings:g1:2026-10');
    expect(draft.data).toMatchObject({ goal: 'iPhone', behind: 1, perMonth: '33750.00', targetDate: '2027-01-31' });
  });

  it('skips goals that are reached or not active', () => {
    expect(savingsReminders('b1', '2026-10', today, [{ ...goal, currentAmount: '150000.00' }, { ...goal, id: 'g2', paceStatus: null }])).toEqual([]);
  });

  it('asks for the whole rest within the last month', () => {
    const [draft] = savingsReminders('b1', '2026-10', today, [{ ...goal, targetDate: new Date('2026-10-20T00:00:00.000Z'), paceStatus: 'ON_TRACK' }]);
    expect(draft.data).toMatchObject({ behind: 0, perMonth: '101250.00' });
  });
});

describe('announcementReminders', () => {
  it('carries both languages and the start as its time', () => {
    const startAt = new Date('2026-09-29T04:00:00.000Z');
    const [draft] = announcementReminders([{ id: 'a1', title: 'New', titleBn: 'নতুন', body: 'Body', bodyBn: null, startAt }]);
    expect(draft).toEqual({ key: 'announcement:a1', type: 'ANNOUNCEMENT', businessId: null, data: { title: 'New', titleBn: 'নতুন', body: 'Body', bodyBn: null }, at: startAt });
  });
});

describe('zakatReminders', () => {
  const line = { businessId: 'b1', dueDate: '2027-02-08', zakat: 28548, paid: 0 };

  it('reminds 30 and 3 days before, the nearer one when both are due', () => {
    expect(zakatReminders('2027-01-09', [line])).toEqual([
      { key: 'zakat:b1:2027-02-08:30', type: 'ZAKAT', businessId: 'b1', data: { dueDate: '2027-02-08', days: 30, left: '28548.00', zakat: '28548.00' } },
    ]);
    expect(zakatReminders('2027-02-06', [line]).map((d) => d.key)).toEqual(['zakat:b1:2027-02-08:3']);
    expect(zakatReminders('2027-02-08', [line]).map((d) => d.key)).toEqual(['zakat:b1:2027-02-08:3']);
  });

  it('says nothing too early, after the date, or once it is all given', () => {
    expect(zakatReminders('2026-12-01', [line])).toEqual([]);
    expect(zakatReminders('2027-02-09', [line])).toEqual([]);
    expect(zakatReminders('2027-02-06', [{ ...line, paid: 28548 }])).toEqual([]);
  });
});
