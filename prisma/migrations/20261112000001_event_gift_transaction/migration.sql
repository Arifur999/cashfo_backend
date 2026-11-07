-- AlterTable
ALTER TABLE "EventGift" ADD COLUMN     "transactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EventGift_transactionId_key" ON "EventGift"("transactionId");
