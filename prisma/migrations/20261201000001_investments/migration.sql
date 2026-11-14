-- CreateEnum
CREATE TYPE "InvestmentKind" AS ENUM ('BUSINESS', 'SANCHAYAPATRA', 'FDR', 'SHARES', 'PROPERTY', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'IRREGULAR');

-- CreateEnum
CREATE TYPE "InvestmentPayoutMode" AS ENUM ('FIXED', 'RATE', 'NONE');

-- CreateEnum
CREATE TYPE "InvestmentEntryType" AS ENUM ('INVEST', 'ADD', 'PROFIT', 'BACK', 'LOSS');

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "InvestmentKind" NOT NULL DEFAULT 'OTHER',
    "startDate" DATE NOT NULL,
    "frequency" "InvestmentFrequency" NOT NULL DEFAULT 'IRREGULAR',
    "payoutMode" "InvestmentPayoutMode" NOT NULL DEFAULT 'NONE',
    "fixedAmount" DECIMAL(14,2),
    "ratePercent" DECIMAL(5,2),
    "firstDueDate" DATE,
    "maturityDate" DATE,
    "profitAccountId" TEXT,
    "note" TEXT,
    "closedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentEntry" (
    "id" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "InvestmentEntryType" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accountId" TEXT,
    "transactionId" TEXT,
    "note" TEXT,
    "fromClose" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentDeletion" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "deletedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "InvestmentDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Investment_businessId_idx" ON "Investment"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentEntry_transactionId_key" ON "InvestmentEntry"("transactionId");

-- CreateIndex
CREATE INDEX "InvestmentEntry_investmentId_idx" ON "InvestmentEntry"("investmentId");

-- CreateIndex
CREATE INDEX "InvestmentEntry_businessId_date_idx" ON "InvestmentEntry"("businessId", "date");

-- CreateIndex
CREATE INDEX "InvestmentDeletion_deletedAt_idx" ON "InvestmentDeletion"("deletedAt");

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentEntry" ADD CONSTRAINT "InvestmentEntry_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
