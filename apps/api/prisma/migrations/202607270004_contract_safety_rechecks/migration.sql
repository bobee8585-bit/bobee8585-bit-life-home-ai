CREATE TYPE "ContractSafetyRecheckStatus" AS ENUM ('RUNNING', 'PASSED', 'BLOCKED', 'FAILED');

CREATE TABLE "contract_safety_rechecks" (
  "id" UUID NOT NULL,
  "contract_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" "ContractSafetyRecheckStatus" NOT NULL DEFAULT 'RUNNING',
  "registry_decision" VARCHAR(40),
  "owner_matched" BOOLEAN,
  "registry_risk_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "registry_issued_at" TIMESTAMPTZ(6),
  "registry_checked_at" TIMESTAMPTZ(6),
  "registry_provider" VARCHAR(80),
  "registry_reference_hash" VARCHAR(64),
  "guarantee_eligibility" "GuaranteeEligibility" NOT NULL DEFAULT 'UNKNOWN',
  "guarantee_reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "guarantee_checked_at" TIMESTAMPTZ(6),
  "guarantee_provider" VARCHAR(80),
  "guarantee_reference_hash" VARCHAR(64),
  "failure_code" VARCHAR(80),
  "result_snapshot" JSONB,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "contract_safety_rechecks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_safety_rechecks_contract_id_attempt_key"
  ON "contract_safety_rechecks"("contract_id", "attempt");
CREATE INDEX "contract_safety_rechecks_contract_id_status_created_at_idx"
  ON "contract_safety_rechecks"("contract_id", "status", "created_at");
CREATE INDEX "contract_safety_rechecks_status_expires_at_idx"
  ON "contract_safety_rechecks"("status", "expires_at");
CREATE INDEX "contract_safety_rechecks_requested_by_user_id_created_at_idx"
  ON "contract_safety_rechecks"("requested_by_user_id", "created_at");

ALTER TABLE "contract_safety_rechecks"
  ADD CONSTRAINT "contract_safety_rechecks_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "electronic_contracts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_safety_rechecks"
  ADD CONSTRAINT "contract_safety_rechecks_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
