-- How many paras of the Quran were read on each day of a Ramadan sheet.
-- CreateTable
CREATE TABLE "RamadanParaLog" (
    "id" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "paras" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RamadanParaLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RamadanParaLog_trackerId_day_key" ON "RamadanParaLog"("trackerId", "day");

-- AddForeignKey
ALTER TABLE "RamadanParaLog" ADD CONSTRAINT "RamadanParaLog_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "HabitMonthTracker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
