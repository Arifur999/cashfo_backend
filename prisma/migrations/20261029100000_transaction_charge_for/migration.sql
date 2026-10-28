-- A charge (a bank or service fee) posted with a loan entry points at that entry.
ALTER TABLE "Transaction" ADD COLUMN     "chargeForId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_chargeForId_idx" ON "Transaction"("chargeForId");
