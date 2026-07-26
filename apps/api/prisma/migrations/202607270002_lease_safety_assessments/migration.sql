CREATE TYPE "LeaseSafetyAssessmentStatus" AS ENUM ('READY', 'INCOMPLETE');
CREATE TYPE "LeaseSafetyGrade" AS ENUM ('VERY_SAFE', 'SAFE', 'CAUTION', 'HIGH_RISK', 'CRITICAL', 'UNAVAILABLE');
CREATE TYPE "GuaranteeEligibility" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'UNKNOWN');

CREATE TABLE "lease_safety_assessments" (
  "id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "analyst_user_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "LeaseSafetyAssessmentStatus" NOT NULL,
  "score" INTEGER,
  "grade" "LeaseSafetyGrade" NOT NULL,
  "estimated_market_value" DECIMAL(18,2),
  "senior_claim_amount" DECIMAL(18,2),
  "jeonse_ratio" DECIMAL(7,4),
  "total_exposure_ratio" DECIMAL(7,4),
  "owner_matched" BOOLEAN,
  "guarantee_eligibility" "GuaranteeEligibility" NOT NULL DEFAULT 'UNKNOWN',
  "registry_risk_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "registry_issued_at" TIMESTAMPTZ(6),
  "valuation_assessed_at" TIMESTAMPTZ(6),
  "registry_source" VARCHAR(100),
  "valuation_source" VARCHAR(100),
  "evidence_reference_hash" VARCHAR(64),
  "missing_inputs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deduction_breakdown" JSONB NOT NULL,
  "calculation_version" VARCHAR(40) NOT NULL,
  "assessed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lease_safety_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lease_safety_assessments_version_check" CHECK ("version" > 0),
  CONSTRAINT "lease_safety_assessments_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
  CONSTRAINT "lease_safety_assessments_amount_check" CHECK (
    ("estimated_market_value" IS NULL OR "estimated_market_value" > 0)
    AND ("senior_claim_amount" IS NULL OR "senior_claim_amount" >= 0)
  ),
  CONSTRAINT "lease_safety_assessments_ready_check" CHECK (
    ("status" = 'READY' AND "score" IS NOT NULL AND "grade" <> 'UNAVAILABLE' AND cardinality("missing_inputs") = 0)
    OR
    ("status" = 'INCOMPLETE' AND "score" IS NULL AND "grade" = 'UNAVAILABLE')
  )
);

CREATE UNIQUE INDEX "lease_safety_assessments_property_id_version_key"
ON "lease_safety_assessments"("property_id", "version");
CREATE INDEX "lease_safety_assessments_property_id_assessed_at_idx"
ON "lease_safety_assessments"("property_id", "assessed_at");
CREATE INDEX "lease_safety_assessments_status_assessed_at_idx"
ON "lease_safety_assessments"("status", "assessed_at");

ALTER TABLE "lease_safety_assessments"
ADD CONSTRAINT "lease_safety_assessments_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_safety_assessments"
ADD CONSTRAINT "lease_safety_assessments_analyst_user_id_fkey"
FOREIGN KEY ("analyst_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
