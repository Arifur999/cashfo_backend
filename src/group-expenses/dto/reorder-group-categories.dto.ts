import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

// Every category of the group, in the order it should be listed.
export class ReorderGroupCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];
}
