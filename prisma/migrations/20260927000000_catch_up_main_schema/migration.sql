-- Catch-up for tables that were added to schema.prisma on main without a
-- migration (Habit Tracker, Group Expense): the Railway deploy only runs
-- `prisma migrate deploy`, so without this a database built from the
-- migrations alone never gets them.
--
-- Written to be idempotent -- every statement skips an object that already
-- exists -- so it also applies cleanly to a database that already got these
-- tables some other way (e.g. `prisma db push`), including one pushed from an
-- older schema: every column is also added if missing. What this can't do is
-- change the TYPE of a column that exists in an older form -- run
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
-- against such a database after deploying to confirm it matches.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "HabitFrequency" AS ENUM ('DAILY', 'WEEKLY_DAYS', 'WEEKLY_COUNT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "GroupMemberStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
ALTER TYPE "WorkspaceType" ADD VALUE IF NOT EXISTS 'GROUP';

-- CreateTable
CREATE TABLE IF NOT EXISTS "Habit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Others',
    "icon" TEXT NOT NULL DEFAULT 'target',
    "color" TEXT NOT NULL DEFAULT 'blue',
    "frequencyType" "HabitFrequency" NOT NULL DEFAULT 'DAILY',
    "weeklyDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "weeklyCount" INTEGER,
    "targetValue" INTEGER,
    "unit" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Habit_pkey" PRIMARY KEY ("id")
);

-- Columns added to "Habit" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'Others';
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "icon" TEXT NOT NULL DEFAULT 'target';
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'blue';
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "frequencyType" "HabitFrequency" NOT NULL DEFAULT 'DAILY';
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "weeklyDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "weeklyCount" INTEGER;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "targetValue" INTEGER;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "HabitLog" (
    "id" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "value" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitLog_pkey" PRIMARY KEY ("id")
);

-- Columns added to "HabitLog" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "habitId" TEXT NOT NULL;
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "date" DATE NOT NULL;
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "completed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "value" INTEGER;
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "HabitMonthTracker" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "totalDays" INTEGER,
    "items" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitMonthTracker_pkey" PRIMARY KEY ("id")
);

-- Columns added to "HabitMonthTracker" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL;
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "month" INTEGER NOT NULL;
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "year" INTEGER NOT NULL;
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "totalDays" INTEGER;
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "items" TEXT[];
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "HabitMonthCheck" (
    "id" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "item" TEXT NOT NULL,

    CONSTRAINT "HabitMonthCheck_pkey" PRIMARY KEY ("id")
);

-- Columns added to "HabitMonthCheck" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "HabitMonthCheck" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "HabitMonthCheck" ADD COLUMN IF NOT EXISTS "trackerId" TEXT NOT NULL;
ALTER TABLE "HabitMonthCheck" ADD COLUMN IF NOT EXISTS "day" INTEGER NOT NULL;
ALTER TABLE "HabitMonthCheck" ADD COLUMN IF NOT EXISTS "item" TEXT NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GroupMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "photoUrl" TEXT,
    "status" "GroupMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- Columns added to "GroupMember" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "businessId" TEXT NOT NULL;
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL;
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "status" "GroupMemberStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GroupContribution" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "groupMemberId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupContribution_pkey" PRIMARY KEY ("id")
);

-- Columns added to "GroupContribution" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "GroupContribution" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "GroupContribution" ADD COLUMN IF NOT EXISTS "businessId" TEXT NOT NULL;
ALTER TABLE "GroupContribution" ADD COLUMN IF NOT EXISTS "groupMemberId" TEXT NOT NULL;
ALTER TABLE "GroupContribution" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(14,2) NOT NULL;
ALTER TABLE "GroupContribution" ADD COLUMN IF NOT EXISTS "date" DATE NOT NULL;
ALTER TABLE "GroupContribution" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "GroupContribution" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GroupExpense" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "description" TEXT,
    "paidByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupExpense_pkey" PRIMARY KEY ("id")
);

-- Columns added to "GroupExpense" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "businessId" TEXT NOT NULL;
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(14,2) NOT NULL;
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "date" DATE NOT NULL;
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "paidByMemberId" TEXT;
ALTER TABLE "GroupExpense" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GroupExpenseCategoryOption" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupExpenseCategoryOption_pkey" PRIMARY KEY ("id")
);

-- Columns added to "GroupExpenseCategoryOption" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "businessId" TEXT NOT NULL;
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL;
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "icon" TEXT;
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL;
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "GroupExpenseCategoryOption" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GroupMonthlyBudget" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "budgetAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMonthlyBudget_pkey" PRIMARY KEY ("id")
);

-- Columns added to "GroupMonthlyBudget" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "GroupMonthlyBudget" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "GroupMonthlyBudget" ADD COLUMN IF NOT EXISTS "businessId" TEXT NOT NULL;
ALTER TABLE "GroupMonthlyBudget" ADD COLUMN IF NOT EXISTS "month" INTEGER NOT NULL;
ALTER TABLE "GroupMonthlyBudget" ADD COLUMN IF NOT EXISTS "year" INTEGER NOT NULL;
ALTER TABLE "GroupMonthlyBudget" ADD COLUMN IF NOT EXISTS "budgetAmount" DECIMAL(14,2) NOT NULL;
ALTER TABLE "GroupMonthlyBudget" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "GroupMonthlyBudget" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GroupSettlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalExpense" DECIMAL(14,2) NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "perMemberShare" DECIMAL(14,2) NOT NULL,
    "closedBy" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupSettlement_pkey" PRIMARY KEY ("id")
);

-- Columns added to "GroupSettlement" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "businessId" TEXT NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "periodStart" DATE NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "periodEnd" DATE NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "totalExpense" DECIMAL(14,2) NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "memberCount" INTEGER NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "perMemberShare" DECIMAL(14,2) NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "closedBy" TEXT NOT NULL;
ALTER TABLE "GroupSettlement" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GroupSettlementMember" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "groupMemberId" TEXT NOT NULL,
    "contributed" DECIMAL(14,2) NOT NULL,
    "share" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "GroupSettlementMember_pkey" PRIMARY KEY ("id")
);

-- Columns added to "GroupSettlementMember" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "GroupSettlementMember" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "GroupSettlementMember" ADD COLUMN IF NOT EXISTS "settlementId" TEXT NOT NULL;
ALTER TABLE "GroupSettlementMember" ADD COLUMN IF NOT EXISTS "groupMemberId" TEXT NOT NULL;
ALTER TABLE "GroupSettlementMember" ADD COLUMN IF NOT EXISTS "contributed" DECIMAL(14,2) NOT NULL;
ALTER TABLE "GroupSettlementMember" ADD COLUMN IF NOT EXISTS "share" DECIMAL(14,2) NOT NULL;
ALTER TABLE "GroupSettlementMember" ADD COLUMN IF NOT EXISTS "balance" DECIMAL(14,2) NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Habit_userId_idx" ON "Habit"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HabitLog_habitId_date_idx" ON "HabitLog"("habitId", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HabitLog_habitId_date_key" ON "HabitLog"("habitId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HabitMonthTracker_userId_category_idx" ON "HabitMonthTracker"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HabitMonthTracker_userId_category_month_year_key" ON "HabitMonthTracker"("userId", "category", "month", "year");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HabitMonthCheck_trackerId_idx" ON "HabitMonthCheck"("trackerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HabitMonthCheck_trackerId_day_item_key" ON "HabitMonthCheck"("trackerId", "day", "item");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupMember_businessId_status_idx" ON "GroupMember"("businessId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupContribution_businessId_date_idx" ON "GroupContribution"("businessId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupContribution_groupMemberId_idx" ON "GroupContribution"("groupMemberId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupExpense_businessId_date_idx" ON "GroupExpense"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GroupExpenseCategoryOption_businessId_name_key" ON "GroupExpenseCategoryOption"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GroupMonthlyBudget_businessId_month_year_key" ON "GroupMonthlyBudget"("businessId", "month", "year");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupSettlement_businessId_periodStart_idx" ON "GroupSettlement"("businessId", "periodStart");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupSettlementMember_settlementId_idx" ON "GroupSettlementMember"("settlementId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Habit" ADD CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "HabitMonthTracker" ADD CONSTRAINT "HabitMonthTracker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "HabitMonthCheck" ADD CONSTRAINT "HabitMonthCheck_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "HabitMonthTracker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupContribution" ADD CONSTRAINT "GroupContribution_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupContribution" ADD CONSTRAINT "GroupContribution_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupExpense" ADD CONSTRAINT "GroupExpense_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupExpense" ADD CONSTRAINT "GroupExpense_paidByMemberId_fkey" FOREIGN KEY ("paidByMemberId") REFERENCES "GroupMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupExpenseCategoryOption" ADD CONSTRAINT "GroupExpenseCategoryOption_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupMonthlyBudget" ADD CONSTRAINT "GroupMonthlyBudget_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupSettlement" ADD CONSTRAINT "GroupSettlement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupSettlementMember" ADD CONSTRAINT "GroupSettlementMember_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "GroupSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "GroupSettlementMember" ADD CONSTRAINT "GroupSettlementMember_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
