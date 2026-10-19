-- Group expenses: a family or a mess, its settings and meals, expenses paid from
-- a pocket and shared in other ways, members' joining and leaving days, and
-- the kind of each contribution.
-- CreateEnum
CREATE TYPE "GroupKind" AS ENUM ('FAMILY', 'MESS');

-- CreateEnum
CREATE TYPE "GroupSplit" AS ENUM ('EQUAL', 'SHARES', 'MEALS', 'EXACT');

-- CreateEnum
CREATE TYPE "GroupPaidFrom" AS ENUM ('FUND', 'MEMBER');

-- CreateEnum
CREATE TYPE "GroupContributionKind" AS ENUM ('DEPOSIT', 'RETURN', 'SETTLE', 'CARRY');

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "joinedOn" DATE,
ADD COLUMN     "leftOn" DATE,
ADD COLUMN     "shareUnits" DECIMAL(6,2) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "GroupContribution" ADD COLUMN     "kind" "GroupContributionKind" NOT NULL DEFAULT 'DEPOSIT';

-- AlterTable
ALTER TABLE "GroupExpense" ADD COLUMN     "paidFrom" "GroupPaidFrom" NOT NULL DEFAULT 'FUND',
ADD COLUMN     "split" "GroupSplit" NOT NULL DEFAULT 'EQUAL';

-- AlterTable
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN     "defaultSplit" "GroupSplit" NOT NULL DEFAULT 'EQUAL';

-- AlterTable
ALTER TABLE "GroupSettlement" ADD COLUMN     "carriedForward" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cashInHand" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mealExpense" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mealRate" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "mealUnits" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GroupSettlementMember" ADD COLUMN     "mealCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "mealUnits" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pocketPaid" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GroupSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "GroupKind" NOT NULL DEFAULT 'FAMILY',
    "monthStartDay" INTEGER NOT NULL DEFAULT 1,
    "cashHolderMemberId" TEXT,
    "mealsOn" BOOLEAN NOT NULL DEFAULT false,
    "breakfastUnits" DECIMAL(4,2) NOT NULL DEFAULT 0.5,
    "lunchUnits" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "dinnerUnits" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupExpenseSplit" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "groupMemberId" TEXT NOT NULL,
    "units" DECIMAL(8,2),
    "amount" DECIMAL(14,2),

    CONSTRAINT "GroupExpenseSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMeal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "groupMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "breakfast" INTEGER NOT NULL DEFAULT 0,
    "lunch" INTEGER NOT NULL DEFAULT 0,
    "dinner" INTEGER NOT NULL DEFAULT 0,
    "guests" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupSettings_businessId_key" ON "GroupSettings"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupExpenseSplit_expenseId_groupMemberId_key" ON "GroupExpenseSplit"("expenseId", "groupMemberId");

-- CreateIndex
CREATE INDEX "GroupMeal_businessId_date_idx" ON "GroupMeal"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMeal_groupMemberId_date_key" ON "GroupMeal"("groupMemberId", "date");

-- AddForeignKey
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupExpenseSplit" ADD CONSTRAINT "GroupExpenseSplit_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "GroupExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupExpenseSplit" ADD CONSTRAINT "GroupExpenseSplit_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money given back was always a negative amount: say so.
UPDATE "GroupContribution" SET "kind" = 'RETURN' WHERE "amount" < 0;
