import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';
import { CreateAssetCategoryDto } from './create-asset-category.dto.js';

export class UpdateAssetCategoryDto extends PartialType(CreateAssetCategoryDto) {
  // Asset categories' Active switch: an inactive one is hidden from the
  // Purchase and Add asset dropdowns; its assets stay as they are.
  @ValidateIf(whenSent)
  @IsBoolean()
  isActive?: boolean;
}
