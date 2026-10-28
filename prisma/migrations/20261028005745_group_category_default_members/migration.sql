-- AlterTable
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN     "defaultMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
