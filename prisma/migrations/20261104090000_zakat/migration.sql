-- Zakat calculator: a workspace's zakat choices, lines added by hand, zakat
-- given (each an expense), and the metal and weight of gold or silver assets.

-- CreateEnum
CREATE TYPE "ZakatMetal" AS ENUM ('GOLD_22', 'GOLD_21', 'GOLD_18', 'GOLD_TRADITIONAL', 'SILVER_22');

-- CreateEnum
CREATE TYPE "ZakatBasis" AS ENUM ('SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "ZakatDateMode" AS ENUM ('RAMADAN', 'MUHARRAM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ZakatGroup" AS ENUM ('CASH', 'SAVINGS', 'GOLD', 'INVESTMENTS', 'OWED_TO_YOU', 'YOU_OWE');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "metal" "ZakatMetal",
ADD COLUMN     "weightVori" DECIMAL(10,3);

-- CreateTable
CREATE TABLE "ZakatProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "basis" "ZakatBasis" NOT NULL DEFAULT 'SILVER',
    "dateMode" "ZakatDateMode" NOT NULL DEFAULT 'RAMADAN',
    "customDate" TEXT,
    "goldPrice" DECIMAL(14,2),
    "silverPrice" DECIMAL(14,2),
    "excluded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "debtFull" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forSale" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checked" JSONB,
    "lastZakat" DECIMAL(14,2),
    "lastDueDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZakatProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZakatExtra" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "group" "ZakatGroup" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "metal" "ZakatMetal",
    "weightVori" DECIMAL(10,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZakatExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZakatPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "givenTo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZakatPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZakatProfile_businessId_key" ON "ZakatProfile"("businessId");

-- CreateIndex
CREATE INDEX "ZakatExtra_businessId_idx" ON "ZakatExtra"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "ZakatPayment_transactionId_key" ON "ZakatPayment"("transactionId");

-- CreateIndex
CREATE INDEX "ZakatPayment_businessId_dueDate_idx" ON "ZakatPayment"("businessId", "dueDate");

-- AddForeignKey
ALTER TABLE "ZakatProfile" ADD CONSTRAINT "ZakatProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZakatExtra" ADD CONSTRAINT "ZakatExtra_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZakatPayment" ADD CONSTRAINT "ZakatPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

