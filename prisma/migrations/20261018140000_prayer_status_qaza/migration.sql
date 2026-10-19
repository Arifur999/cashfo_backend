-- A Namaz mark says how the prayer was prayed (marks from before read as
-- ON_TIME); qaza counting gets its start day and a log of qaza made up.
-- CreateEnum
CREATE TYPE "PrayerStatus" AS ENUM ('JAMAAT', 'ON_TIME', 'QAZA', 'MISSED');

-- AlterTable
ALTER TABLE "HabitMonthCheck" ADD COLUMN     "status" "PrayerStatus" NOT NULL DEFAULT 'ON_TIME';

-- CreateTable
CREATE TABLE "PrayerSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "qazaSince" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrayerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QazaLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prayer" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QazaLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrayerSettings_userId_key" ON "PrayerSettings"("userId");

-- CreateIndex
CREATE INDEX "QazaLog_userId_date_idx" ON "QazaLog"("userId", "date");

-- AddForeignKey
ALTER TABLE "PrayerSettings" ADD CONSTRAINT "PrayerSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QazaLog" ADD CONSTRAINT "QazaLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

