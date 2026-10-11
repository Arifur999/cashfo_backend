-- Passwords move onto better-auth's credential accounts: one AuthAccount row
-- per user with providerId 'credential' and accountId = the user's own id
-- (the layout better-auth's email sign-in looks for). Hashes are copied
-- unchanged -- better-auth is configured to verify bcrypt.
INSERT INTO "AuthAccount" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'credential', "id", "passwordHash", "createdAt", CURRENT_TIMESTAMP
FROM "User"
WHERE "passwordHash" IS NOT NULL
ON CONFLICT ("providerId", "accountId") DO NOTHING;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash";
