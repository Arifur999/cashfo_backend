-- Skills (canvas v16): chapters as a unit, a category, a link, the reason,
-- a target day, a pause, the ground covered before tracking ("Already
-- done"), an undoable delete, a note on each day of practice, and a
-- roadmap, notes and resources for each skill.

-- CreateEnum
CREATE TYPE "SkillResourceKind" AS ENUM ('COURSE', 'VIDEO', 'BOOK', 'LINK');

-- AlterEnum
ALTER TYPE "SkillUnit" ADD VALUE 'CHAPTERS';

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "base" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'life',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "link" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "targetDate" DATE,
ADD COLUMN     "why" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SkillLog" ADD COLUMN     "note" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SkillStep" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillNote" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillResource" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "kind" "SkillResourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillStep_skillId_position_idx" ON "SkillStep"("skillId", "position");

-- CreateIndex
CREATE INDEX "SkillNote_skillId_date_idx" ON "SkillNote"("skillId", "date");

-- CreateIndex
CREATE INDEX "SkillResource_skillId_createdAt_idx" ON "SkillResource"("skillId", "createdAt");

-- AddForeignKey
ALTER TABLE "SkillStep" ADD CONSTRAINT "SkillStep_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillNote" ADD CONSTRAINT "SkillNote_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillResource" ADD CONSTRAINT "SkillResource_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- What was there before: the ground covered before the log began is the
-- progress the log accounted for, less the days logged; the category
-- follows the icon the skill was given.
UPDATE "Skill" s SET "base" = GREATEST(0, LEAST(s."target", s."loggedProgress") - COALESCE((SELECT SUM(l."amount") FROM "SkillLog" l WHERE l."skillId" = s."id"), 0));
UPDATE "Skill" SET "category" = CASE "icon"
  WHEN 'code' THEN 'tech'
  WHEN 'languages' THEN 'lang'
  WHEN 'palette' THEN 'design'
  WHEN 'camera' THEN 'design'
  WHEN 'pen' THEN 'design'
  WHEN 'music' THEN 'design'
  WHEN 'briefcase' THEN 'biz'
  WHEN 'calculator' THEN 'biz'
  ELSE 'life'
END;
