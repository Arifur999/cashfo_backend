import { PartialType } from '@nestjs/mapped-types';
import { CreateSavingsPlanDto } from './create-savings-plan.dto.js';

// Any of a plan's fields; the day it was planned stays.
export class UpdateSavingsPlanDto extends PartialType(CreateSavingsPlanDto) {}
