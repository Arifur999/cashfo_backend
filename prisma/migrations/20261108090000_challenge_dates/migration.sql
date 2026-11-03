-- AlterTable
ALTER TABLE "HabitMonthTracker" ADD COLUMN     "endedOnDay" INTEGER,
ADD COLUMN     "startsOn" DATE;

-- Every challenge so far counted from the UTC date of createdAt (stored as
-- UTC without a zone, so the cast reads that date): keep that day 1.
UPDATE "HabitMonthTracker" SET "startsOn" = "createdAt"::date WHERE "category" = 'Others';
