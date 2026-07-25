CREATE TYPE "PropertyListingType" AS ENUM ('BROKERAGE', 'OWNER_DIRECT');
CREATE TYPE "OwnershipClaimType" AS ENUM ('REGISTERED_OWNER', 'AUTHORIZED_REPRESENTATIVE');
CREATE TYPE "OwnershipVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

ALTER TABLE "properties"
  ADD COLUMN "listing_type" "PropertyListingType" NOT NULL DEFAULT 'BROKERAGE',
  ALTER COLUMN "brokerage_office_id" DROP NOT NULL;

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_listing_type_office_check"
  CHECK (
    ("listing_type" = 'BROKERAGE' AND "brokerage_office_id" IS NOT NULL)
    OR
    ("listing_type" = 'OWNER_DIRECT' AND "brokerage_office_id" IS NULL)
  );

CREATE TABLE "property_ownership_verifications" (
  "id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "claimant_user_id" UUID NOT NULL,
  "claim_type" "OwnershipClaimType" NOT NULL,
  "evidence_reference_encrypted" TEXT NOT NULL,
  "evidence_reference_hash" TEXT NOT NULL,
  "status" "OwnershipVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "ownership_declaration_at" TIMESTAMPTZ(6) NOT NULL,
  "no_brokerage_declaration_at" TIMESTAMPTZ(6) NOT NULL,
  "rejection_reason" TEXT,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "property_ownership_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "property_ownership_verifications_property_id_key"
  ON "property_ownership_verifications"("property_id");
CREATE INDEX "property_ownership_verifications_status_created_at_idx"
  ON "property_ownership_verifications"("status", "created_at");
CREATE INDEX "property_ownership_verifications_claimant_user_id_status_created_at_idx"
  ON "property_ownership_verifications"("claimant_user_id", "status", "created_at");
CREATE INDEX "property_ownership_verifications_evidence_reference_hash_idx"
  ON "property_ownership_verifications"("evidence_reference_hash");

ALTER TABLE "property_ownership_verifications"
  ADD CONSTRAINT "property_ownership_verifications_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_ownership_verifications"
  ADD CONSTRAINT "property_ownership_verifications_claimant_user_id_fkey"
  FOREIGN KEY ("claimant_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "property_ownership_verifications"
  ADD CONSTRAINT "property_ownership_verifications_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
