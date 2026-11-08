-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNSAID');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customerNumber" SERIAL NOT NULL,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "occupation" TEXT,
ADD COLUMN     "phone2" TEXT,
ADD COLUMN     "phone2WhatsApp" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_customerNumber_key" ON "User"("customerNumber");
