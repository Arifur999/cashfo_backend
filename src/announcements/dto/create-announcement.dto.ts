import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { AnnouncementType } from '@prisma/client';

// "/habit-tracker" (not "//host", which leaves the site) or "https://…".
export const ANNOUNCEMENT_LINK = /^(\/(?!\/)\S*|https:\/\/\S+)$/;

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  titleBn?: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsString()
  bodyBn?: string;

  @IsEnum(AnnouncementType)
  type: AnnouncementType;

  @IsOptional()
  @IsString()
  targetPlan?: string;

  @IsISO8601()
  startAt: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  // The banner's "Try it": a page of the app or an https address; null
  // takes it away.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  @Matches(ANNOUNCEMENT_LINK, { message: 'The link must be a page of the app (/…) or an https:// address' })
  linkUrl?: string | null;
}
