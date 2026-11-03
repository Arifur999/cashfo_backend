import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, Max, Min } from 'class-validator';

// Ramadan › Today's "Get ready" steps, by key (the app words them).
export const RAMADAN_PREP_KEYS = ['intention', 'makeUp', 'quran', 'sadaqah', 'tahajjud'] as const;

export class RamadanPrepQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}

export class SaveRamadanPrepDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsArray()
  @ArrayMaxSize(RAMADAN_PREP_KEYS.length)
  @IsIn(RAMADAN_PREP_KEYS, { each: true })
  items: string[];
}

// "I kept one": the fasts of a Ramadan sheet made up since.
export class SetFastsMadeUpDto {
  @IsInt()
  @Min(0)
  @Max(30)
  count: number;
}
