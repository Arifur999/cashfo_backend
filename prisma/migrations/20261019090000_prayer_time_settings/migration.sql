-- Where and how a person's prayer times are worked out, and how their Hijri
-- date is shifted to the moon as seen locally.
-- CreateEnum
CREATE TYPE "AsrSchool" AS ENUM ('HANAFI', 'SHAFII');

-- AlterTable
ALTER TABLE "PrayerSettings" ADD COLUMN     "asrSchool" "AsrSchool" NOT NULL DEFAULT 'HANAFI',
ADD COLUMN     "city" TEXT NOT NULL DEFAULT 'Dhaka',
ADD COLUMN     "hijriAdjust" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "latitude" DOUBLE PRECISION NOT NULL DEFAULT 23.8103,
ADD COLUMN     "longitude" DOUBLE PRECISION NOT NULL DEFAULT 90.4125,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'Karachi';

