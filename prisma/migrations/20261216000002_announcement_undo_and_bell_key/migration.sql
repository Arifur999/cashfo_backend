-- Announcements deleted for everyone are kept, so the admin can undo.
ALTER TABLE "Announcement" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- An announcement's bell rows, found by key when it is edited.
CREATE INDEX "UserNotification_key_idx" ON "UserNotification"("key");
