-- CreateTable
CREATE TABLE "GroupCashHandover" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupCashHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupCashHandover_businessId_date_idx" ON "GroupCashHandover"("businessId", "date");

-- CreateIndex
CREATE INDEX "GroupCashHandover_fromMemberId_idx" ON "GroupCashHandover"("fromMemberId");

-- CreateIndex
CREATE INDEX "GroupCashHandover_toMemberId_idx" ON "GroupCashHandover"("toMemberId");

-- AddForeignKey
ALTER TABLE "GroupCashHandover" ADD CONSTRAINT "GroupCashHandover_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCashHandover" ADD CONSTRAINT "GroupCashHandover_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCashHandover" ADD CONSTRAINT "GroupCashHandover_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

