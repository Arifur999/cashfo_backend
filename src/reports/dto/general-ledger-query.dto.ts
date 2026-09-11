import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Paginates at the ACCOUNT level (see ReportsService.getGeneralLedger()) --
// defaults are generous since a workspace's Chart of Accounts realistically
// never approaches this size, but the params exist for completeness.
export class GeneralLedgerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
