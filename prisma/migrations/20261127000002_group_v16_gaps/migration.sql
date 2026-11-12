-- CreateEnum
CREATE TYPE "GroupPayMethod" AS ENUM ('CASH', 'BKASH', 'NAGAD', 'BANK');

-- AlterTable
ALTER TABLE "GroupContribution" ADD COLUMN     "payMethod" "GroupPayMethod";

-- AlterTable
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN     "monthlyLimit" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "GroupSettings" ADD COLUMN     "firstMonth" TEXT,
ADD COLUMN     "newCategorySplit" "GroupSplit" NOT NULL DEFAULT 'EQUAL';
