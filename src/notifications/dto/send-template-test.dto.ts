import { IsIn, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Which language of the template the test shows; English when not sent.
export class SendTemplateTestDto {
  @ValidateIf(whenSent)
  @IsIn(['EN', 'BN'])
  language?: 'EN' | 'BN';
}
