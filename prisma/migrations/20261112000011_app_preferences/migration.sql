-- CreateEnum
CREATE TYPE "StartPage" AS ENUM ('DASHBOARD', 'REPORTS', 'INCOME_EXPENSE', 'GROUP', 'CALENDAR');

-- CreateEnum
CREATE TYPE "FiscalYearStart" AS ENUM ('JANUARY', 'JULY');

-- AlterTable
ALTER TABLE "BusinessMember" ADD COLUMN     "defaultAccountId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "compactTables" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fiscalYearStart" "FiscalYearStart" NOT NULL DEFAULT 'JULY',
ADD COLUMN     "roundAmounts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rowsPerPage" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "showHijri" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sidebarCollapsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startPage" "StartPage" NOT NULL DEFAULT 'DASHBOARD';
