-- The original an edited entry corrects (decision D2).
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "correctedFromId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_correctedFromId_key" ON "Transaction"("correctedFromId");
