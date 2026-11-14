import { ZakatBasis, ZakatDateMode, ZakatGroup, ZakatMetal } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// A price per vori: whole taka, from 1 up to ৳ 1 crore.
const MAX_PRICE = 10_000_000;
// Up to 10,000 vori, three decimals (a gram is 0.086 vori).
const MAX_VORI = 10_000;

// Zakat settings: what is sent changes; null on a price goes back to the platform's.
export class UpdateZakatSettingsDto {
  @ValidateIf(whenSent)
  @IsIn(Object.values(ZakatBasis))
  basis?: ZakatBasis;

  @ValidateIf(whenSent)
  @IsIn(Object.values(ZakatDateMode))
  dateMode?: ZakatDateMode;

  @ValidateIf(whenSent)
  @Matches(DAY, { message: 'customDate must look like 2027-01-15' })
  customDate?: string;

  @ValidateIf((dto: UpdateZakatSettingsDto) => dto.goldPrice !== undefined && dto.goldPrice !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE)
  goldPrice?: number | null;

  @ValidateIf((dto: UpdateZakatSettingsDto) => dto.silverPrice !== undefined && dto.silverPrice !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE)
  silverPrice?: number | null;
}

// A line counted or left out: "account:<id>", "contact:<id>", "asset:<id>"
// or "investment:<id>".
export class ZakatLineDto {
  @Matches(/^(account|contact|asset|investment):[0-9a-f-]{36}$/, { message: 'Unknown line' })
  key: string;

  @IsBoolean()
  counted: boolean;
}

// A debt taken off whole, or only what falls due within 12 months.
export class ZakatDebtModeDto {
  @IsIn(['YEAR', 'FULL'])
  mode: 'YEAR' | 'FULL';
}

export class ZakatForSaleDto {
  @IsBoolean()
  forSale: boolean;
}

export const ZAKAT_STEPS = ['CASH', 'SAVINGS', 'GOLD', 'INVESTMENTS', 'OWED_TO_YOU', 'YOU_OWE'] as const;
export type ZakatStep = (typeof ZAKAT_STEPS)[number];

// "Yes, this is right" on a step, or taken back.
export class ZakatCheckDto {
  @IsIn(ZAKAT_STEPS)
  step: ZakatStep;

  @IsBoolean()
  checked: boolean;
}

// Something not in the app: money, or gold and silver by weight.
export class CreateZakatExtraDto {
  @IsIn(Object.values(ZakatGroup))
  group: ZakatGroup;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ValidateIf((dto: CreateZakatExtraDto) => dto.group !== 'GOLD')
  @IsMoney()
  @Min(1)
  amount?: number;

  @ValidateIf((dto: CreateZakatExtraDto) => dto.group === 'GOLD')
  @IsIn(Object.values(ZakatMetal))
  metal?: ZakatMetal;

  @ValidateIf((dto: CreateZakatExtraDto) => dto.group === 'GOLD')
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(MAX_VORI)
  weightVori?: number;
}

// A gold or silver asset's metal and weight; both null: valued as before.
export class ZakatAssetWeightDto {
  @ValidateIf((dto: ZakatAssetWeightDto) => dto.metal !== null)
  @IsIn(Object.values(ZakatMetal))
  metal: ZakatMetal | null;

  @ValidateIf((dto: ZakatAssetWeightDto) => dto.weightVori !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(MAX_VORI)
  weightVori: number | null;
}

// Zakat given: an expense under Zakat from one wallet.
export class RecordZakatDto {
  @IsMoney()
  @Min(1)
  amount: number;

  @Matches(DAY, { message: 'paidOn must look like 2026-11-02' })
  paidOn: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accountId: string;

  // Only the member sees it.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  givenTo?: string;
}

// Admin > Settings: the BAJUS prices per vori.
export class UpdateZakatPricesDto {
  @IsInt()
  @Min(1000)
  @Max(MAX_PRICE)
  gold22: number;

  @IsInt()
  @Min(100)
  @Max(MAX_PRICE)
  silver22: number;

  @Matches(DAY, { message: 'on must look like 2026-10-31' })
  on: string;
}
