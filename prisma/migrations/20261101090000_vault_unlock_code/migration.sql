-- The Password Manager's second unlock step: a code by email after the
-- vault password.
ALTER TYPE "OneTimeCodePurpose" ADD VALUE 'VAULT_UNLOCK';
