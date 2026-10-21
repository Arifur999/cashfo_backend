import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { trim, whenSent } from '../../common/dto.js';

// metadata.app on the rows these reports write. ErrorSource has no
// customer-app value (adding one is a schema change), so they share the
// frontend source with the admin panel's reports and this is what tells
// them apart -- GET /admin/system/errors?app=customer filters on it.
export const CUSTOMER_APP = 'customer';

// The customer app's error screen reporting what it showed: the message, the
// reference it printed (Next's error digest, which the customer is asked to
// quote to support) and the page. Any signed-in customer can send one, so
// every field is short and nothing else is accepted -- the global
// ValidationPipe refuses unknown fields, a stack trace included.
export class ReportClientErrorDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  digest?: string;

  // The page's pathname. A query string or fragment is dropped before the
  // row is written (see ErrorLogsService.reportCustomerError).
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @Matches(/^\//, { message: 'path must start with /' })
  path?: string;
}
