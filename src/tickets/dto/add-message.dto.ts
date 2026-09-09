import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AddMessageDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}
