ALTER TABLE "collateral_types"
ADD COLUMN "has_expiry_date" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "expiry_warning_days" INTEGER;

ALTER TABLE "collateral_types"
ADD CONSTRAINT "collateral_types_expiry_policy_check"
CHECK (
  ("has_expiry_date" = false AND "expiry_warning_days" IS NULL)
  OR
  (
    "has_expiry_date" = true
    AND "expiry_warning_days" BETWEEN 1 AND 3650
  )
);
