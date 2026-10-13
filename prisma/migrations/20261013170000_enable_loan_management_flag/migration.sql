-- Feature flags now take effect in the customer app (GET /api/platform), and
-- loan_management hides the Loan Management section when off. It was seeded
-- off while doing nothing, so turning it on keeps the section customers have
-- today. Only the untouched seed default is changed.
UPDATE "FeatureFlag"
SET "isEnabled" = true, "rolloutPercent" = 100, "updatedAt" = NOW()
WHERE "key" = 'loan_management' AND "isEnabled" = false AND "rolloutPercent" = 0;
