-- CreateEnum
CREATE TYPE "AiSection" AS ENUM ('TRANSACTIONS', 'SAVINGS', 'LOANS', 'GROUPS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiInsights" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiReads" "AiSection"[] DEFAULT ARRAY['TRANSACTIONS', 'SAVINGS', 'LOANS']::"AiSection"[];
