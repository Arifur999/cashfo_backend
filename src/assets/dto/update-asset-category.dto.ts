import { PartialType } from '@nestjs/mapped-types';
import { CreateAssetCategoryDto } from './create-asset-category.dto.js';

export class UpdateAssetCategoryDto extends PartialType(CreateAssetCategoryDto) {}
