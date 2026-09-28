-- Idempotent like the catch-up migration before it, so it also applies to a
-- database this schema was already `prisma db push`ed to.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "BookStatus" AS ENUM ('WANT_TO_READ', 'READING', 'FINISHED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SkillUnit" AS ENUM ('LESSONS', 'HOURS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SkillStatus" AS ENUM ('WANT_TO_LEARN', 'LEARNING', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "HabitMonthTracker" ADD COLUMN IF NOT EXISTS "name" TEXT,
ALTER COLUMN "month" DROP NOT NULL,
ALTER COLUMN "year" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Book" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT '',
    "totalPages" INTEGER NOT NULL,
    "pagesRead" INTEGER NOT NULL DEFAULT 0,
    "status" "BookStatus" NOT NULL DEFAULT 'WANT_TO_READ',
    "color" TEXT NOT NULL DEFAULT 'walnut',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- Columns added to "Book" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "author" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "totalPages" INTEGER NOT NULL;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "pagesRead" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "status" "BookStatus" NOT NULL DEFAULT 'WANT_TO_READ';
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'walnut';
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BookGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "target" INTEGER NOT NULL,

    CONSTRAINT "BookGoal_pkey" PRIMARY KEY ("id")
);

-- Columns added to "BookGoal" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "BookGoal" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "BookGoal" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "BookGoal" ADD COLUMN IF NOT EXISTS "year" INTEGER NOT NULL;
ALTER TABLE "BookGoal" ADD COLUMN IF NOT EXISTS "target" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Skill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "unit" "SkillUnit" NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "loggedProgress" INTEGER NOT NULL DEFAULT 0,
    "status" "SkillStatus" NOT NULL DEFAULT 'WANT_TO_LEARN',
    "color" TEXT NOT NULL DEFAULT 'violet',
    "icon" TEXT NOT NULL DEFAULT 'sparkles',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- Columns added to "Skill" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "unit" "SkillUnit" NOT NULL;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "target" INTEGER NOT NULL;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "loggedProgress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "status" "SkillStatus" NOT NULL DEFAULT 'WANT_TO_LEARN';
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'violet';
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "icon" TEXT NOT NULL DEFAULT 'sparkles';
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SkillLog" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "SkillLog_pkey" PRIMARY KEY ("id")
);

-- Columns added to "SkillLog" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "SkillLog" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "SkillLog" ADD COLUMN IF NOT EXISTS "skillId" TEXT NOT NULL;
ALTER TABLE "SkillLog" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "SkillLog" ADD COLUMN IF NOT EXISTS "date" DATE NOT NULL;
ALTER TABLE "SkillLog" ADD COLUMN IF NOT EXISTS "amount" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SkillGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "target" INTEGER NOT NULL,

    CONSTRAINT "SkillGoal_pkey" PRIMARY KEY ("id")
);

-- Columns added to "SkillGoal" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "SkillGoal" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "SkillGoal" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "SkillGoal" ADD COLUMN IF NOT EXISTS "year" INTEGER NOT NULL;
ALTER TABLE "SkillGoal" ADD COLUMN IF NOT EXISTS "target" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Book_userId_status_idx" ON "Book"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BookGoal_userId_year_key" ON "BookGoal"("userId", "year");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Skill_userId_status_idx" ON "Skill"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SkillLog_userId_date_idx" ON "SkillLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SkillLog_skillId_date_key" ON "SkillLog"("skillId", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SkillGoal_userId_year_key" ON "SkillGoal"("userId", "year");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Book" ADD CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "BookGoal" ADD CONSTRAINT "BookGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Skill" ADD CONSTRAINT "Skill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SkillLog" ADD CONSTRAINT "SkillLog_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SkillGoal" ADD CONSTRAINT "SkillGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only Others challenges may leave month/year empty: a Namaz or Ramadan row
-- without them would slip past the one-sheet-per-month unique index (NULLs
-- never collide) and break every read of the user's trackers. Prisma can't
-- express CHECK constraints, so this lives only here.
DO $$ BEGIN
    ALTER TABLE "HabitMonthTracker" ADD CONSTRAINT "HabitMonthTracker_dated_unless_others_check" CHECK ("category" = 'Others' OR ("month" IS NOT NULL AND "year" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
