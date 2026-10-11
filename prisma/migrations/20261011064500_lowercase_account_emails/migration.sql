-- Account emails are stored lowercase from now on (better-auth looks every
-- address up lowercased, and the auth DTOs lowercase what clients send).

-- Two accounts that differ only by case are one person or a typo -- either
-- way a human decides. Stop here instead of guessing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" GROUP BY lower("email") HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Two accounts differ only by email case; resolve them by hand, then migrate again';
  END IF;
END $$;

UPDATE "User" SET "email" = lower("email") WHERE "email" <> lower("email");

-- Login history is keyed by email; keep it matching the stored address.
UPDATE "LoginAttempt" SET "email" = lower("email") WHERE "email" <> lower("email");
