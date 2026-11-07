import { Matches } from 'class-validator';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// The days the cash flow covers, both included.
export class MoneyFlowQueryDto {
  @Matches(DAY, { message: 'dateFrom must look like 2026-10-01' })
  dateFrom!: string;

  @Matches(DAY, { message: 'dateTo must look like 2026-10-31' })
  dateTo!: string;
}
