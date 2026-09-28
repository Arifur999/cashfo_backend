import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTodoItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text: string;
}
