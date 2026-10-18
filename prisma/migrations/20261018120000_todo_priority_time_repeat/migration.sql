-- To-do tasks get a priority, a time, the day they were moved from, and
-- repeat rules that add a task to its days by themselves.
-- CreateEnum
CREATE TYPE "TodoPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TodoRepeatKind" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "dueTime" TEXT,
ADD COLUMN     "movedFrom" DATE,
ADD COLUMN     "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "repeatId" TEXT;

-- CreateTable
CREATE TABLE "TodoRepeat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueTime" TEXT,
    "kind" "TodoRepeatKind" NOT NULL,
    "weekdays" INTEGER[],
    "monthDay" INTEGER,
    "startsOn" DATE NOT NULL,
    "filledThrough" DATE,
    "endsOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoRepeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TodoRepeat_userId_idx" ON "TodoRepeat"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TodoItem_repeatId_listId_key" ON "TodoItem"("repeatId", "listId");

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_repeatId_fkey" FOREIGN KEY ("repeatId") REFERENCES "TodoRepeat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoRepeat" ADD CONSTRAINT "TodoRepeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

