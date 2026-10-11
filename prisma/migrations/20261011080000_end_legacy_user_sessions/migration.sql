-- Devices signed in before better-auth hold refresh tokens with no session id
-- (sid), which the app no longer accepts. Mark them signed out so Device
-- Management and the login history match what can actually still be used.
UPDATE "UserSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "revokedAt" IS NULL;
