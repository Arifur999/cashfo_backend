import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateGroupMemberDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
