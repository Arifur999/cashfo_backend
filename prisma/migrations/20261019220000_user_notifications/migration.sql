-- The bell's feed (UserNotification) and the user's reminder switches.

-- CreateEnum
CREATE TYPE "UserNotificationType" AS ENUM ('BUDGET', 'LOAN_DUE', 'SAVINGS', 'ANNOUNCEMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "remindBudget" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "remindLoans" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "remindSavings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remindersCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT,
    "type" "UserNotificationType" NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserNotification_userId_createdAt_idx" ON "UserNotification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_userId_key_key" ON "UserNotification"("userId", "key");

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
