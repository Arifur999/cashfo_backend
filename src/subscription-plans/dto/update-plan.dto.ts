import { PartialType } from '@nestjs/mapped-types';
import { CreatePlanDto } from './create-plan.dto.js';

// Every field optional for PATCH, but featureLimits (when provided) must
// still be the complete shape -- edits replace the whole object rather than
// deep-merging, which keeps the "explicit keys only" validation simple.
export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
