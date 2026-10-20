-- When each admin last marked the bell's feed as read.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminFeedSeenAt" TIMESTAMP(3);
