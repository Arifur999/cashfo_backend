-- CreateEnum
CREATE TYPE "GroupAccessLinkKind" AS ENUM ('JOIN', 'RESET');

-- AlterEnum
ALTER TYPE "GroupMemberRole" ADD VALUE 'VIEWER';

-- AlterTable
ALTER TABLE "GroupCashHandover" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "GroupContribution" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "GroupExpense" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "portalOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "GroupAccessLink" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "groupMemberId" TEXT NOT NULL,
    "kind" "GroupAccessLinkKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenSealed" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupAccessLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupAccessLink_groupMemberId_key" ON "GroupAccessLink"("groupMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAccessLink_tokenHash_key" ON "GroupAccessLink"("tokenHash");

-- CreateIndex
CREATE INDEX "GroupAccessLink_businessId_idx" ON "GroupAccessLink"("businessId");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_businessId_userId_key" ON "GroupMember"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAccessLink" ADD CONSTRAINT "GroupAccessLink_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAccessLink" ADD CONSTRAINT "GroupAccessLink_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

