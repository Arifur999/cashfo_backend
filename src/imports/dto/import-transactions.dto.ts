import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

// The most rows one request carries; the page sends a long file in parts.
export const IMPORT_CHUNK = 100;

// One row of the file, matched to Smartly's fields by the person.
export class ImportRowDto {
  // Its row number in the file (the header is row 1), for the report.
  @IsInt()
  @Min(2)
  row: number;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsIn(['INCOME', 'EXPENSE'])
  type: 'INCOME' | 'EXPENSE';

  @IsMoney()
  amount: number;

  // A category's name; one the workspace lacks is added.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  category?: string;

  // A wallet's name; the first wallet when left out.
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  wallet?: string;

  @ValidateIf(whenSent)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ImportTransactionsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fileName: string;

  // The file's sha-256: the same file imported again adds nothing twice.
  @Matches(/^[0-9a-f]{64}$/)
  fileKey: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_CHUNK)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}
