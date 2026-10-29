-- The automatic messages now go out in their template's wording while it is on.
-- Start them off, so nothing customers get changes (and no SMS is paid for)
-- until an admin turns one on in Notifications > Templates.
UPDATE "NotificationTemplate" SET "isActive" = false WHERE "key" IN ('welcome', 'subscription_expiring', 'payment_successful', 'payment_failed', 'ticket_reply');
