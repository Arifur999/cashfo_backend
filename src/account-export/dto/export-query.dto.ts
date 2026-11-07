import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, Matches, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { EXPORT_SECTIONS, type ExportSection } from '../account-export.service.js';

// Settings › Data & privacy › Export. Nothing sent: every record, as
// Settings › Resources › Download my data has always done.
export class ExportQueryDto {
  // Comma-separated, e.g. "ie,savings".
  @ValidateIf(whenSent)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(EXPORT_SECTIONS.length)
  @IsIn(EXPORT_SECTIONS, { each: true })
  sections?: ExportSection[];

  @ValidateIf(whenSent)
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';

  @ValidateIf(whenSent)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ValidateIf(whenSent)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
