import { Matches, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// GET /api/businesses/groups/summary?month=YYYY-MM -- each group's current
// month when left out.
export class GroupSummaryQueryDto {
  @ValidateIf(whenSent)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month?: string;
}
