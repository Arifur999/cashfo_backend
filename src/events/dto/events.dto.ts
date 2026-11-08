import { GiftDirection, GiftKind, SocialEventType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { IsMoney, trim, whenSent } from '../../common/dto.js';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

// A new event: someone else's (a host by id, or a new person by name) or
// the customer's own.
export class CreateEventDto {
  @IsIn(Object.values(SocialEventType))
  type!: SocialEventType;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  @Matches(DAY, { message: 'date must look like 2026-11-14' })
  date!: string;

  @ValidateIf(whenSent)
  @Matches(CLOCK, { message: 'time must look like 13:30' })
  time?: string | null;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  place?: string | null;

  // The customer's own event: no host, and its gifts are received.
  @IsBoolean()
  mine!: boolean;

  @ValidateIf((dto: CreateEventDto) => !dto.mine && dto.hostName === undefined)
  @IsString()
  @IsNotEmpty()
  hostId?: string;

  @ValidateIf((dto: CreateEventDto) => !dto.mine && dto.hostId === undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  hostName?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  hostRelation?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  remind?: boolean;
}

// What is sent changes; null clears the time or the place.
export class UpdateEventDto {
  @ValidateIf(whenSent)
  @IsIn(Object.values(SocialEventType))
  type?: SocialEventType;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title?: string;

  @ValidateIf(whenSent)
  @Matches(DAY, { message: 'date must look like 2026-11-14' })
  date?: string;

  @ValidateIf((dto: UpdateEventDto) => dto.time !== undefined && dto.time !== null)
  @Matches(CLOCK, { message: 'time must look like 13:30' })
  time?: string | null;

  @ValidateIf((dto: UpdateEventDto) => dto.place !== undefined && dto.place !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  place?: string | null;

  @ValidateIf(whenSent)
  @IsBoolean()
  remind?: boolean;
}

// A gift at an event, given or received, to or from a person by id or a
// new one by name (else the event's host).
export class CreateGiftDto {
  // Received at the customer's own events and given at others', unless
  // sent.
  @ValidateIf(whenSent)
  @IsIn(Object.values(GiftDirection))
  direction?: GiftDirection;

  @ValidateIf((dto: CreateGiftDto) => dto.personId !== undefined)
  @IsString()
  @IsNotEmpty()
  personId?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  personName?: string;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  personRelation?: string;

  @IsIn(Object.values(GiftKind))
  kind!: GiftKind;

  // The item, for an ITEM gift.
  @ValidateIf((dto: CreateGiftDto) => dto.kind === 'ITEM')
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  item?: string;

  @IsMoney()
  amount!: number;

  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;

  // Cash given can also go into Transactions as a Gifts expense, out of
  // this wallet.
  @ValidateIf(whenSent)
  @IsString()
  @IsNotEmpty()
  fromAccountId?: string;
}

export class UpdateGiftDto {
  @ValidateIf(whenSent)
  @IsIn(Object.values(GiftKind))
  kind?: GiftKind;

  @ValidateIf((dto: UpdateGiftDto) => dto.item !== undefined && dto.item !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  item?: string | null;

  @ValidateIf(whenSent)
  @IsMoney()
  amount?: number;

  @ValidateIf((dto: UpdateGiftDto) => dto.note !== undefined && dto.note !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class UpdatePersonDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ValidateIf((dto: UpdatePersonDto) => dto.relation !== undefined && dto.relation !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  relation?: string | null;
}
