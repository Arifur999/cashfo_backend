import { ContactCategory } from '@prisma/client';
import { IsIn, ValidateIf } from 'class-validator';
import { whenSent } from '../../common/dto.js';

// Narrows aging, overdue and due-soon to one kind of contact: BUSINESS
// (Books' customers and suppliers) or LOAN (Loan Management's lenders and
// borrowers). Left out, every contact counts, as it always has.
export class ContactCategoryQueryDto {
  @ValidateIf(whenSent)
  @IsIn(Object.values(ContactCategory))
  category?: ContactCategory;
}
