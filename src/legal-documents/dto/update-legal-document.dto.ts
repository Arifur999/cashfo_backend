import { IsOptional, IsString } from 'class-validator';

export class UpdateLegalDocumentDto {
  @IsOptional()
  @IsString()
  contentEn?: string;

  @IsOptional()
  @IsString()
  contentBn?: string;
}
