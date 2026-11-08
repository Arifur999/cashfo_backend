-- To Do List v16: a Someday list with no date, lists (categories) a task is
-- filed under, and a task's note, steps, put-off count and the time it was done.

-- AlterTable
ALTER TABLE "TodoItem" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "moveCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "steps" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "TodoList" ADD COLUMN     "somedayOf" TEXT,
ALTER COLUMN "date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TodoRepeat" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "steps" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "TodoCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TodoCategory_userId_idx" ON "TodoCategory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TodoCategory_userId_key_key" ON "TodoCategory"("userId", "key");

-- CreateIndex
CREATE INDEX "TodoItem_categoryId_idx" ON "TodoItem"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "TodoList_somedayOf_key" ON "TodoList"("somedayOf");

-- CreateIndex
CREATE INDEX "TodoRepeat_categoryId_idx" ON "TodoRepeat"("categoryId");

-- AddForeignKey
ALTER TABLE "TodoCategory" ADD CONSTRAINT "TodoCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TodoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoRepeat" ADD CONSTRAINT "TodoRepeat_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TodoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Tasks already done: ticked on their own day, as far as anyone can tell
-- (noon in Dhaka, 06:00 UTC).
UPDATE "TodoItem" AS i SET "completedAt" = l."date" + TIME '06:00'
FROM "TodoList" AS l
WHERE i."listId" = l."id" AND i."completed" = true AND l."date" IS NOT NULL;

-- Tasks already moved were put off once.
UPDATE "TodoItem" SET "moveCount" = 1 WHERE "movedFrom" IS NOT NULL;
