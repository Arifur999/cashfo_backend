import { Transform } from 'class-transformer';
import { IsEnum, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { GroupAccessLinkKind } from '@prisma/client';
import { whenSent } from '../../common/dto.js';

// Members › Give access or Send a reset link.
export class CreateAccessLinkDto {
  @IsEnum(GroupAccessLinkKind)
  kind: GroupAccessLinkKind;
}

// The member's side of a link: the username they pick (a JOIN link only)
// and their password, held to the app's own password rule.
export class AcceptAccessLinkDto {
  @ValidateIf(whenSent)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @Matches(/^[a-z0-9._]{4,20}$/, { message: 'Use 4 to 20 small letters, numbers, dot or underscore, like rakib.m' })
  username?: string;

  // better-auth refuses passwords over 128 characters.
  @IsString()
  @MaxLength(128)
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
  password: string;
}
