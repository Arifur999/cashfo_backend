-- Admin accounts are created by a super admin who vouches for the address,
-- so they count as verified. better-auth links a Google sign-in to an
-- existing account only when that account's email is verified -- the guard
-- against someone registering a stranger's address first -- so this is what
-- lets an admin use "Continue with Google". End-user accounts stay
-- unverified until the app has an email verification flow.
UPDATE "User" SET "emailVerified" = true WHERE "role" <> 'USER';
