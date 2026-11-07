-- CreateEnum
CREATE TYPE "SocialEventType" AS ENUM ('WEDDING', 'HOLUD', 'AQIQAH', 'KHATNA', 'BIRTHDAY', 'MILAD', 'EID', 'OTHER');

-- CreateEnum
CREATE TYPE "GiftDirection" AS ENUM ('GAVE', 'GOT');

-- CreateEnum
CREATE TYPE "GiftKind" AS ENUM ('CASH', 'ITEM');

-- AlterEnum
ALTER TYPE "UserNotificationType" ADD VALUE 'EVENT';

-- CreateTable
CREATE TABLE "EventPerson" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "SocialEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT,
    "place" TEXT,
    "hostId" TEXT,
    "remind" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventGift" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "direction" "GiftDirection" NOT NULL,
    "kind" "GiftKind" NOT NULL,
    "item" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventPerson_businessId_idx" ON "EventPerson"("businessId");

-- CreateIndex
CREATE INDEX "SocialEvent_businessId_date_idx" ON "SocialEvent"("businessId", "date");

-- CreateIndex
CREATE INDEX "SocialEvent_hostId_idx" ON "SocialEvent"("hostId");

-- CreateIndex
CREATE INDEX "EventGift_businessId_idx" ON "EventGift"("businessId");

-- CreateIndex
CREATE INDEX "EventGift_eventId_idx" ON "EventGift"("eventId");

-- CreateIndex
CREATE INDEX "EventGift_personId_idx" ON "EventGift"("personId");

-- AddForeignKey
ALTER TABLE "EventPerson" ADD CONSTRAINT "EventPerson_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialEvent" ADD CONSTRAINT "SocialEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialEvent" ADD CONSTRAINT "SocialEvent_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "EventPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGift" ADD CONSTRAINT "EventGift_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGift" ADD CONSTRAINT "EventGift_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SocialEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGift" ADD CONSTRAINT "EventGift_personId_fkey" FOREIGN KEY ("personId") REFERENCES "EventPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
