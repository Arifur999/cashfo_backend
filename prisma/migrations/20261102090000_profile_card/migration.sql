-- Settings > Profile: a cover photo, a one-line address, and the shareable
-- profile card switch.
ALTER TABLE "User" ADD COLUMN "coverUrl" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "profileCardSharedAt" TIMESTAMP(3);
