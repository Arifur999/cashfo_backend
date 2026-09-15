import { PartialType } from '@nestjs/mapped-types';
import { CreateVaultEntryDto } from './create-vault-entry.dto.js';

export class UpdateVaultEntryDto extends PartialType(CreateVaultEntryDto) {}
