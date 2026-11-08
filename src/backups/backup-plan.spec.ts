import { ownedWhere, planBackup, type ForeignKey } from './backup-plan.js';

const fk = (table: string, column: string, references: string, notNull = true, refColumn = 'id'): ForeignKey => ({
  table,
  column,
  references,
  refColumn,
  notNull,
});

describe('the backup plan', () => {
  const fks = [
    fk('TransactionEntry', 'transactionId', 'Transaction'),
    fk('TransactionEntry', 'accountId', 'Account'),
    fk('Transaction', 'businessId', 'Business'),
    fk('Transaction', 'contactId', 'Contact', false),
    fk('Account', 'businessId', 'Business'),
    fk('Account', 'parentId', 'Account', false),
    fk('Contact', 'businessId', 'Business'),
    fk('SavingsGoalEntry', 'savingsGoalId', 'SavingsGoal'),
    fk('SavingsGoalEntry', 'businessId', 'Business'),
    fk('SavingsGoal', 'businessId', 'Business'),
    fk('BusinessMember', 'businessId', 'Business'),
    fk('BusinessMember', 'userId', 'User'),
    fk('Business', 'ownerId', 'User'),
    fk('Habit', 'userId', 'User'),
    fk('Note', 'businessId', 'Business', false),
  ];

  it('takes every table under a workspace, parents first, and leaves the rest', () => {
    const plan = planBackup(fks);
    const tables = plan.map((row) => row.table);
    expect(tables.sort()).toEqual(['Account', 'Contact', 'SavingsGoal', 'SavingsGoalEntry', 'Transaction', 'TransactionEntry']);
    const order = planBackup(fks).map((row) => row.table);
    expect(order.indexOf('Contact')).toBeLessThan(order.indexOf('Transaction'));
    expect(order.indexOf('Account')).toBeLessThan(order.indexOf('TransactionEntry'));
    expect(order.indexOf('Transaction')).toBeLessThan(order.indexOf('TransactionEntry'));
  });

  it('ties a row to its workspace by its own businessId when it has one', () => {
    const plan = planBackup(fks);
    expect(plan.find((row) => row.table === 'SavingsGoalEntry')).toMatchObject({ column: 'businessId', parent: null });
    expect(plan.find((row) => row.table === 'TransactionEntry')).toMatchObject({ column: 'transactionId', parent: 'Transaction' });
    expect(ownedWhere(plan, 'TransactionEntry', '$1', 't')).toBe('t."transactionId" IN (SELECT "id" FROM "Transaction" WHERE "businessId" = ANY($1::text[]))');
  });

  it('refuses tables that point at each other in a loop', () => {
    expect(() =>
      planBackup([fk('A', 'businessId', 'Business'), fk('B', 'businessId', 'Business'), fk('A', 'bId', 'B', false), fk('B', 'aId', 'A', false)]),
    ).toThrow(/loop: A, B/);
  });

  it('never builds SQL from an odd name', () => {
    expect(() => ownedWhere(planBackup([fk('Bad"Table', 'businessId', 'Business')]), 'Bad"Table', '$1')).toThrow(/Unexpected/);
  });
});
