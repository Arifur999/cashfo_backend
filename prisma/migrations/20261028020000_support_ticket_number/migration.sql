-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "number" SERIAL NOT NULL;

-- Number the tickets that already exist oldest first, and carry on from there.
UPDATE "SupportTicket" AS t SET "number" = o.n
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n FROM "SupportTicket") AS o
WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"SupportTicket"', 'number'), COALESCE((SELECT MAX("number") FROM "SupportTicket"), 0) + 1, false);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");
