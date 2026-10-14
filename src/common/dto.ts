// Shared class-transformer / class-validator helpers.
import { ValidateBy, buildMessage, type ValidationOptions } from 'class-validator';

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Account emails are stored lowercase -- better-auth looks every address up
// that way -- so each one a client sends is trimmed and lowercased first.
export const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// Optional fields use ValidateIf(whenSent), not IsOptional: IsOptional also
// skips an explicit null, which would then reach the service as a value (a
// null title would crash it, a null status would count as "moved to a shelf").
export const whenSent = (_: unknown, value: unknown) => value !== undefined;

// The largest amount a Decimal(14,2) money column holds.
export const MAX_MONEY = 999_999_999_999.99;

export const isMoney = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0.01 && value <= MAX_MONEY && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

// A money amount sent as a JSON number: from 0.01 to MAX_MONEY, at most two
// decimals. Replaces IsNumber({ maxDecimalPlaces: 2 }) + IsPositive: that
// check throws -- a 500 -- on numbers JavaScript prints in exponent form
// (1e-7), and amounts past the column's range reached the database.
export function IsMoney(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isMoney',
      validator: {
        validate: isMoney,
        defaultMessage: buildMessage((each) => `${each}$property must be an amount from 0.01 to 999,999,999,999.99 with at most two decimals`, validationOptions),
      },
    },
    validationOptions,
  );
}

// An amount sent as a string (opening balances, which may be negative):
// up to twelve whole digits and two decimals, what a Decimal(14,2) column
// holds -- IsNumberString let any length through and a third decimal was
// silently rounded away.
export const MONEY_STRING_REGEX = /^-?\d{1,12}(\.\d{1,2})?$/;
export const MONEY_STRING_MESSAGE = 'must be an amount with at most twelve digits before the point and two after it';
