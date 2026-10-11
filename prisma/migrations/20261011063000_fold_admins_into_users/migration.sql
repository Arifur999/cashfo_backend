-- Fold the admin team into User: one identity table, with Role telling the
-- two populations apart (see the previous migration).

-- Two different people must never be merged into one account. Stop here and
-- resolve any shared email by hand before re-running.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AdminUser" a JOIN "User" u ON lower(u."email") = lower(a."email")) THEN
    RAISE EXCEPTION 'An AdminUser and a User share an email address; resolve the duplicate, then migrate again';
  END IF;
END $$;

-- Same ids, so AuditLog rows and every loose admin reference (createdBy,
-- assignedToAdminId, reviewedBy, relatedAdminId, ...) keep resolving.
INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "status", "lastLoginAt", "createdBy", "createdAt", "updatedAt")
SELECT "id", "name", "email", "passwordHash", "role"::text::"Role", "status"::text::"UserStatus", "lastLoginAt", "createdBy", "createdAt", "updatedAt"
FROM "AdminUser";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_adminUserId_fkey";

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropTable
DROP TABLE "AdminUser";

-- DropEnum
DROP TYPE "AdminRole";

-- DropEnum
DROP TYPE "AdminStatus";
