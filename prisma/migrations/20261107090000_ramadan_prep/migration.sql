-- AlterTable
ALTER TABLE "HabitMonthTracker" ADD COLUMN     "fastsMadeUp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RamadanPrep" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RamadanPrep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RamadanPrep_userId_year_key" ON "RamadanPrep"("userId", "year");

-- AddForeignKey
ALTER TABLE "RamadanPrep" ADD CONSTRAINT "RamadanPrep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
