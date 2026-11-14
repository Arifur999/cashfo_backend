import { InvestmentFrequency, InvestmentKind, InvestmentPayoutMode } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAY_MESSAGE = (field: string) => ({ message: `${field} must look like 2026-11-14` });

// New investment and Edit investment (both steps of the form): where the
// money went, how much and when, the wallet it came from (null: put in
// earlier, no money moves now), how profit comes and where it comes in.
export class InvestmentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsIn(Object.values(InvestmentKind))
  kind: InvestmentKind;

  // The first amount put in.
  @IsMoney()
  amount: number;

  @Matches(DAY, DAY_MESSAGE('startDate'))
  startDate: string;

  // The wallet the money left; null when it was put in earlier, before the
  // app, and no account changes.
  @ValidateIf((dto: InvestmentDto) => dto.sourceAccountId !== null)
  @IsString()
  @IsNotEmpty()
  sourceAccountId: string | null;

  @IsIn(Object.values(InvestmentFrequency))
  frequency: InvestmentFrequency;

  @IsIn(Object.values(InvestmentPayoutMode))
  payoutMode: InvestmentPayoutMode;

  // Each payout, for payoutMode FIXED.
  @ValidateIf((dto: InvestmentDto) => dto.payoutMode === 'FIXED')
  @IsMoney()
  fixedAmount?: number | null;

  // A yearly rate on the capital, for payoutMode RATE.
  @ValidateIf((dto: InvestmentDto) => dto.payoutMode === 'RATE')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  ratePercent?: number | null;

  // The first payout's day; needed unless profit comes at no fixed time.
  @ValidateIf((dto: InvestmentDto) => dto.frequency !== 'IRREGULAR')
  @Matches(DAY, DAY_MESSAGE('firstDueDate'))
  firstDueDate?: string | null;

  @ValidateIf((dto: InvestmentDto) => dto.maturityDate !== undefined && dto.maturityDate !== null)
  @Matches(DAY, DAY_MESSAGE('maturityDate'))
  maturityDate?: string | null;

  // The wallet profit comes into.
  @IsString()
  @IsNotEmpty()
  profitAccountId: string;

  @ValidateIf((dto: InvestmentDto) => dto.note !== undefined && dto.note !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(140)
  note?: string | null;
}

export const NEW_ENTRY_TYPES = ['ADD', 'PROFIT', 'BACK', 'LOSS'] as const;
export type NewEntryType = (typeof NEW_ENTRY_TYPES)[number];

// Record profit, Invest more, Take capital back, Record a loss.
export class InvestmentEntryDto {
  @IsIn(NEW_ENTRY_TYPES)
  type: NewEntryType;

  @IsMoney()
  amount: number;

  @Matches(DAY, DAY_MESSAGE('date'))
  date: string;

  // The wallet the money came into or left; not sent for a loss.
  @ValidateIf((dto: InvestmentEntryDto) => dto.type !== 'LOSS')
  @IsString()
  @IsNotEmpty()
  accountId?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  note?: string;
}

// Edit entry: its type stays.
export class UpdateInvestmentEntryDto {
  @IsMoney()
  amount: number;

  @Matches(DAY, DAY_MESSAGE('date'))
  date: string;

  @ValidateIf((dto: UpdateInvestmentEntryDto) => dto.accountId !== undefined)
  @IsString()
  @IsNotEmpty()
  accountId?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  note?: string;
}

// Close investment: what came back in the end (0 when nothing did).
export class CloseInvestmentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999.99)
  amount: number;

  @Matches(DAY, DAY_MESSAGE('date'))
  date: string;

  // Needed when anything came back.
  @ValidateIf((dto: CloseInvestmentDto) => dto.amount > 0)
  @IsString()
  @IsNotEmpty()
  accountId?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  note?: string;
}
