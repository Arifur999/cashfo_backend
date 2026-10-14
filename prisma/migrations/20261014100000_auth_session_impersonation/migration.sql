-- A super admin's read-only "View as customer" session names the admin.
ALTER TABLE "AuthSession" ADD COLUMN "impersonatedBy" TEXT;
