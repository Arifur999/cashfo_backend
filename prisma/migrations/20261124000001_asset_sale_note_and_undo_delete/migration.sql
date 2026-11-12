-- The sale's own note, and assets deleted in the last minutes (for Undo).
ALTER TABLE "Asset" ADD COLUMN "soldNote" TEXT;

CREATE TABLE "AssetDeletion" (
    "assetId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "deletedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "AssetDeletion_pkey" PRIMARY KEY ("assetId")
);

CREATE INDEX "AssetDeletion_deletedAt_idx" ON "AssetDeletion"("deletedAt");
