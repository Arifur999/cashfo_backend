-- The support queue's "Help page" tag and "New" badge: whether the customer
-- sent the ticket from Settings › Help, and when an admin first opened it.
ALTER TABLE "SupportTicket" ADD COLUMN     "firstSeenAt" TIMESTAMP(3),
ADD COLUMN     "fromHelpPage" BOOLEAN NOT NULL DEFAULT false;

-- Every ticket from before counts as seen, so the queue doesn't light up
-- with old ones.
UPDATE "SupportTicket" SET "firstSeenAt" = "createdAt";
