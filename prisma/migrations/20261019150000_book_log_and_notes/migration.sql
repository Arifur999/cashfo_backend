-- A day-by-day log of the pages read in each book (the reading streak), and
-- the notes kept on a book.
-- CreateTable
CREATE TABLE "BookLog" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "pages" INTEGER NOT NULL,

    CONSTRAINT "BookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookNote" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "page" INTEGER,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookLog_userId_date_idx" ON "BookLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BookLog_bookId_date_key" ON "BookLog"("bookId", "date");

-- CreateIndex
CREATE INDEX "BookNote_bookId_createdAt_idx" ON "BookNote"("bookId", "createdAt");

-- AddForeignKey
ALTER TABLE "BookLog" ADD CONSTRAINT "BookLog_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookNote" ADD CONSTRAINT "BookNote_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

