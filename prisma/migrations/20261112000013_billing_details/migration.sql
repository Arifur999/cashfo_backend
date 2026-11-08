-- Settings › Plans & billing › Billing details: the name, phone and email
-- printed on receipts (null uses the account's own), and the phone an
-- invoice was issued with.
ALTER TABLE "User" ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingName" TEXT,
ADD COLUMN     "billingPhone" TEXT;

ALTER TABLE "Invoice" ADD COLUMN     "issuedPhone" TEXT;
