import { PartialType } from '@nestjs/mapped-types';
import { CreateAccountTemplateDto } from './create-account-template.dto.js';

export class UpdateAccountTemplateDto extends PartialType(CreateAccountTemplateDto) {}
