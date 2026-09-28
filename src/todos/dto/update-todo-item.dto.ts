import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ValidateIf(v !== undefined), not IsOptional: IsOptional also skips an
// explicit null, which would then reach the service as a value.
const whenSent = (_: unknown, value: unknown) => value !== undefined;

// Both fields are optional -- the same route edits the text and toggles done.
export class UpdateTodoItemDto {
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text?: string;

  @ValidateIf(whenSent)
  @IsBoolean()
  completed?: boolean;
}
