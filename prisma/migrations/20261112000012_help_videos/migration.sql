-- CreateTable
CREATE TABLE "HelpVideo" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleBn" TEXT,
    "category" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "shown" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpVideo_position_idx" ON "HelpVideo"("position");
