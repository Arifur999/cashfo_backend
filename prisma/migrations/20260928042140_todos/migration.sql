-- Idempotent like the two migrations before it, so it also applies to a
-- database this schema was already `prisma db push`ed to.

-- CreateTable
CREATE TABLE IF NOT EXISTS "TodoList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoList_pkey" PRIMARY KEY ("id")
);

-- Columns added to "TodoList" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "TodoList" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "TodoList" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "TodoList" ADD COLUMN IF NOT EXISTS "date" DATE NOT NULL;
ALTER TABLE "TodoList" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TodoItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoItem_pkey" PRIMARY KEY ("id")
);

-- Columns added to "TodoItem" after it was first created, for a table that
-- already existed in an older shape (skipped when it was just created above).
ALTER TABLE "TodoItem" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "TodoItem" ADD COLUMN IF NOT EXISTS "listId" TEXT NOT NULL;
ALTER TABLE "TodoItem" ADD COLUMN IF NOT EXISTS "text" TEXT NOT NULL;
ALTER TABLE "TodoItem" ADD COLUMN IF NOT EXISTS "completed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TodoItem" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TodoList_userId_idx" ON "TodoList"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TodoList_userId_date_key" ON "TodoList"("userId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TodoItem_listId_idx" ON "TodoItem"("listId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TodoList" ADD CONSTRAINT "TodoList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TodoList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
