import { PartialType } from '@nestjs/mapped-types';
import { CreateGroupExpenseCategoryDto } from './create-group-expense-category.dto.js';

export class UpdateGroupExpenseCategoryDto extends PartialType(CreateGroupExpenseCategoryDto) {}
