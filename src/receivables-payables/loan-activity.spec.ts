import { loanActivity, type LoanActivityPosting } from './loan-activity.js';

let seq = 0;
const posting = (contactId: string, kind: LoanActivityPosting['kind'], amount: number, day: string): LoanActivityPosting => {
  seq += 1;
  return { contactId, kind, amount, date: new Date(`${day}T00:00:00.000Z`), createdAt: new Date(2026, 0, 1, 0, 0, seq) };
};

describe('loanActivity', () => {
  it('adds up the month by what the money was for', () => {
    const { month } = loanActivity(
      [
        posting('rahim', 'GAVE', 50000, '2026-11-02'),
        posting('rahim', 'GOT_BACK', 5000, '2026-11-20'),
        posting('islami', 'PROFIT_PAID', 5000, '2026-11-15'),
        posting('islami', 'TOOK', 500000, '2026-01-15'),
        posting('brac', 'PAID_BACK', 2000, '2026-11-30'),
      ],
      '2026-11',
    );
    expect(month).toEqual({ lent: '50000.00', borrowed: '0.00', gotBack: '5000.00', paidBack: '2000.00', profitPaid: '5000.00', profitReceived: '0.00', entries: 4 });
  });

  it("counts each contact's entries and keeps the newest, the later-entered of a day", () => {
    const { byContact } = loanActivity(
      [
        posting('selim', 'GOT_BACK', 20000, '2026-07-25'),
        posting('selim', 'GAVE', 20000, '2026-03-05'),
        posting('hasan', 'GAVE', 3000, '2026-08-20'),
        posting('hasan', 'PROFIT_RECEIVED', 100, '2026-08-20'),
      ],
      '2026-11',
    );
    expect(byContact.get('selim')).toEqual({ entries: 2, last: { kind: 'GOT_BACK', date: '2026-07-25' } });
    expect(byContact.get('hasan')).toEqual({ entries: 2, last: { kind: 'PROFIT_RECEIVED', date: '2026-08-20' } });
    expect(byContact.get('karim')).toBeUndefined();
  });
});
