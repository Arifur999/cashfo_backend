-- Admin › Settings keeps one support email (General's support_email); the
-- Help page's company card shows and changes that same one. A card that
-- saved its own email hands it to support_email (it is what the Help page
-- showed), and the card stops keeping a copy.
INSERT INTO "PlatformSetting" ("id", "key", "value", "updatedAt", "updatedBy")
SELECT gen_random_uuid()::text, 'support_email', to_jsonb(lower(trim(h."value"->>'email'))), now(), h."updatedBy"
FROM "PlatformSetting" h
WHERE h."key" = 'help_company' AND coalesce(trim(h."value"->>'email'), '') <> ''
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now(), "updatedBy" = EXCLUDED."updatedBy";

UPDATE "PlatformSetting" SET "value" = "value" - 'email' WHERE "key" = 'help_company' AND jsonb_typeof("value") = 'object';
