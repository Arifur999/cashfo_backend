-- Idempotent like the migrations before it, so it also applies to a
-- database this schema was already `prisma db push`ed to.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- Columns added to "PasswordResetToken" after it was first created, for a
-- table that already existed in an older shape (skipped when it was just
-- created above).
ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL;
ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL;
ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT NOT NULL;
ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "usedAt" TIMESTAMP(3);
ALTER TABLE "PasswordResetToken" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
