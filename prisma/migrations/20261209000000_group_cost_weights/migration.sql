-- CreateTable
CREATE TABLE "GroupCostWeight" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "groupMemberId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "weight" DECIMAL(7,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupCostWeight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupCostWeight_businessId_effectiveFrom_idx" ON "GroupCostWeight"("businessId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "GroupCostWeight_groupMemberId_effectiveFrom_key" ON "GroupCostWeight"("groupMemberId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "GroupCostWeight" ADD CONSTRAINT "GroupCostWeight_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCostWeight" ADD CONSTRAINT "GroupCostWeight_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

