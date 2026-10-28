import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { NotificationChannel } from '@prisma/client';
import { trim, whenSent } from '../../common/dto.js';

// A new message template (Notifications > Templates > New). The key is how
// campaigns and the code name it: lowercase letters, digits and underscores.
export class CreateNotificationTemplateDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9_]{3,60}$/, { message: 'key must be 3 to 60 lowercase letters, digits or underscores' })
  key: string;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  // For email; null or left out when the channel has no subject.
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(200)
  subjectEn?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(200)
  subjectBn?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  bodyEn: string;

  @IsString()
  @MaxLength(10000)
  bodyBn: string;

  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  variables?: string[];

  @ValidateIf(whenSent)
  @IsBoolean()
  isActive?: boolean;
}
