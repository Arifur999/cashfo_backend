-- Referrals > Profile & payouts > Monthly statement: the switch, and the
-- month last sent so each month goes once.
ALTER TABLE "User" ADD COLUMN     "referralMonthlyStatement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralStatementSentFor" TEXT;
