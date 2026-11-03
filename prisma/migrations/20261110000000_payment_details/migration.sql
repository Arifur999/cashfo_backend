-- Checkout: Rocket and bank transfers, the details a customer sends for a
-- manual payment, and their optional screenshot.
ALTER TYPE "PaymentGateway" ADD VALUE 'ROCKET';
ALTER TYPE "PaymentGateway" ADD VALUE 'BANK';

ALTER TABLE "Payment" ADD COLUMN "submittedAt" TIMESTAMP(3);

CREATE TABLE "PaymentProof" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentProof_paymentId_key" ON "PaymentProof"("paymentId");

ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
