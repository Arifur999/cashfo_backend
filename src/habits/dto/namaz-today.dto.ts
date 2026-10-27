import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// GET /api/namaz/today?date=YYYY-MM-DD -- today in Dhaka when left out.
export class NamazTodayQueryDto {
  @ValidateIf(whenSent)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  @IsISO8601({ strict: true })
  date?: string;
}
