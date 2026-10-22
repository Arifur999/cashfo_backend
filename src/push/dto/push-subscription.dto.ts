import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsNotEmpty, IsString, MaxLength, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { PUSH_LOCALES, type PushLocale } from '../push-payload.js';
import { isPushEndpoint } from '../push-endpoint.js';

const IsPushEndpoint = () =>
  ValidateBy({
    name: 'isPushEndpoint',
    validator: { validate: isPushEndpoint, defaultMessage: () => 'endpoint must be an https address of a browser push service' },
  });

// The browser's PushSubscription.toJSON().keys.
export class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  auth: string;
}

// POST /api/push/subscriptions: this device, and the language its
// notifications are written in (sent again whenever the app loads, so a
// language change follows).
export class SubscribePushDto {
  @IsPushEndpoint()
  endpoint: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  // Left out = English.
  @ValidateIf(whenSent)
  @IsIn(PUSH_LOCALES)
  locale?: PushLocale;
}

// DELETE /api/push/subscriptions: "Turn off" on this device.
export class UnsubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  endpoint: string;
}
