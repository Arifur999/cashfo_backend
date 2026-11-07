-- CreateEnum
CREATE TYPE "DataBackupKind" AS ENUM ('AUTO', 'MANUAL', 'BEFORE_RESTORE');

-- CreateEnum
CREATE TYPE "BackupEvery" AS ENUM ('DAILY', 'WEEKLY');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "importedFrom" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoBackupOn" TEXT,
ADD COLUMN     "backupAuto" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "backupEvery" "BackupEvery" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "backupKeep" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "DataBackup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "DataBackupKind" NOT NULL,
    "size" INTEGER NOT NULL,
    "rawSize" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "workspaces" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataBackup_userId_createdAt_idx" ON "DataBackup"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DataBackup" ADD CONSTRAINT "DataBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
