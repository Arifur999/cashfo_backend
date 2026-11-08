-- My Library (canvas v16): a price, a shelf and a summary on each book,
-- shelves of the reader's own, where each day's reading began, and notes
-- with a kind, the line from the book, a day and highlights.

-- CreateEnum
CREATE TYPE "BookNoteKind" AS ENUM ('HIGHLIGHT', 'UNDERLINE', 'THOUGHT');

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "price" DECIMAL(12,2),
ADD COLUMN     "shelf" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "summary" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "summaryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookLog" ADD COLUMN     "fromPage" INTEGER;

-- AlterTable: a note's day is the Asia/Dhaka (UTC+6, no DST) day it was
-- written on, for the notes written before it could be picked.
ALTER TABLE "BookNote" ADD COLUMN     "date" DATE,
ADD COLUMN     "kind" "BookNoteKind" NOT NULL DEFAULT 'THOUGHT',
ADD COLUMN     "line" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "marks" JSONB;
UPDATE "BookNote" SET "date" = ("createdAt" + INTERVAL '6 hours')::date;
ALTER TABLE "BookNote" ALTER COLUMN "date" SET NOT NULL;

-- CreateTable
CREATE TABLE "BookShelf" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookShelf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookShelf_userId_nameKey_key" ON "BookShelf"("userId", "nameKey");

-- AddForeignKey
ALTER TABLE "BookShelf" ADD CONSTRAINT "BookShelf_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
