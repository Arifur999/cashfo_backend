-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('HABIT', 'CHALLENGE', 'TODO', 'NAMAZ', 'RAMADAN', 'BOOK', 'SKILL');

-- AlterEnum
ALTER TYPE "UserNotificationType" ADD VALUE 'REMINDER';

-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "remindBefore" INTEGER;

-- AlterTable
ALTER TABLE "TodoRepeat" ADD COLUMN     "remindBefore" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "remindHabits" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "times" TEXT[],
    "weekdays" INTEGER[],
    "minutesBefore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Reminder_enabled_kind_idx" ON "Reminder"("enabled", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_userId_kind_targetKey_key" ON "Reminder"("userId", "kind", "targetKey");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
