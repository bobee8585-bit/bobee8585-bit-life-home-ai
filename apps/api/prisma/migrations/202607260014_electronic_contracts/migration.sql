CREATE TYPE "ElectronicContractProvider" AS ENUM ('MODOOSIGN', 'EFORM_SIGN', 'GOVERNMENT');
CREATE TYPE "ElectronicContractStatus" AS ENUM ('DRAFT', 'SIGNING_PENDING', 'PARTIALLY_SIGNED', 'SIGNED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'FAILED');
CREATE TYPE "ElectronicContractPartyRole" AS ENUM ('MEMBER', 'REGISTRANT');
CREATE TYPE "ElectronicContractPartyStatus" AS ENUM ('PENDING', 'VIEWED', 'SIGNED', 'DECLINED');
CREATE TYPE "ContractWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

CREATE TABLE "electronic_contracts" (
  "id" UUID NOT NULL,
  "contract_number" VARCHAR(32) NOT NULL,
  "reservation_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "member_user_id" UUID NOT NULL,
  "registrant_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "provider" "ElectronicContractProvider" NOT NULL,
  "provider_contract_id" VARCHAR(200),
  "status" "ElectronicContractStatus" NOT NULL DEFAULT 'DRAFT',
  "terms_version" VARCHAR(40) NOT NULL,
  "terms_snapshot" JSONB NOT NULL,
  "signed_document_reference_encrypted" TEXT,
  "signed_document_reference_hash" VARCHAR(64),
  "signed_document_hash" VARCHAR(64),
  "signing_expires_at" TIMESTAMPTZ(6),
  "signed_at" TIMESTAMPTZ(6),
  "retained_until" TIMESTAMPTZ(6) NOT NULL,
  "failure_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "electronic_contracts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "electronic_contract_parties" (
  "id" UUID NOT NULL,
  "contract_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "ElectronicContractPartyRole" NOT NULL,
  "status" "ElectronicContractPartyStatus" NOT NULL DEFAULT 'PENDING',
  "viewed_at" TIMESTAMPTZ(6),
  "signed_at" TIMESTAMPTZ(6),
  "declined_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "electronic_contract_parties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "electronic_contract_histories" (
  "id" UUID NOT NULL,
  "contract_id" UUID NOT NULL,
  "previous_status" "ElectronicContractStatus",
  "next_status" "ElectronicContractStatus" NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "event_type" VARCHAR(80),
  "actor_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "electronic_contract_histories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_webhook_events" (
  "id" UUID NOT NULL,
  "provider" "ElectronicContractProvider" NOT NULL,
  "transmission_id" VARCHAR(200) NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "status" "ContractWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "contract_id" UUID,
  "provider_contract_id" VARCHAR(200),
  "payload_hash" VARCHAR(64) NOT NULL,
  "failure_code" VARCHAR(80),
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "contract_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "electronic_contracts_contract_number_key" ON "electronic_contracts"("contract_number");
CREATE UNIQUE INDEX "electronic_contracts_reservation_id_key" ON "electronic_contracts"("reservation_id");
CREATE UNIQUE INDEX "electronic_contracts_provider_contract_id_key" ON "electronic_contracts"("provider_contract_id");
CREATE INDEX "electronic_contracts_member_user_id_status_created_at_idx" ON "electronic_contracts"("member_user_id", "status", "created_at");
CREATE INDEX "electronic_contracts_registrant_user_id_status_created_at_idx" ON "electronic_contracts"("registrant_user_id", "status", "created_at");
CREATE INDEX "electronic_contracts_property_id_status_created_at_idx" ON "electronic_contracts"("property_id", "status", "created_at");
CREATE INDEX "electronic_contracts_status_signing_expires_at_idx" ON "electronic_contracts"("status", "signing_expires_at");
CREATE INDEX "electronic_contracts_retained_until_idx" ON "electronic_contracts"("retained_until");
CREATE UNIQUE INDEX "electronic_contract_parties_contract_id_role_key" ON "electronic_contract_parties"("contract_id", "role");
CREATE UNIQUE INDEX "electronic_contract_parties_contract_id_user_id_key" ON "electronic_contract_parties"("contract_id", "user_id");
CREATE INDEX "electronic_contract_parties_user_id_status_created_at_idx" ON "electronic_contract_parties"("user_id", "status", "created_at");
CREATE INDEX "electronic_contract_histories_contract_id_created_at_idx" ON "electronic_contract_histories"("contract_id", "created_at");
CREATE UNIQUE INDEX "contract_webhook_events_provider_transmission_id_key" ON "contract_webhook_events"("provider", "transmission_id");
CREATE INDEX "contract_webhook_events_status_received_at_idx" ON "contract_webhook_events"("status", "received_at");
CREATE INDEX "contract_webhook_events_contract_id_received_at_idx" ON "contract_webhook_events"("contract_id", "received_at");
CREATE INDEX "contract_webhook_events_provider_contract_id_idx" ON "contract_webhook_events"("provider_contract_id");

ALTER TABLE "electronic_contracts" ADD CONSTRAINT "electronic_contracts_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "visit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_contracts" ADD CONSTRAINT "electronic_contracts_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_contracts" ADD CONSTRAINT "electronic_contracts_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_contracts" ADD CONSTRAINT "electronic_contracts_registrant_user_id_fkey" FOREIGN KEY ("registrant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_contracts" ADD CONSTRAINT "electronic_contracts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_contract_parties" ADD CONSTRAINT "electronic_contract_parties_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "electronic_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "electronic_contract_parties" ADD CONSTRAINT "electronic_contract_parties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "electronic_contract_histories" ADD CONSTRAINT "electronic_contract_histories_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "electronic_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_webhook_events" ADD CONSTRAINT "contract_webhook_events_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "electronic_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN ('GENERAL_USER', 'PROPERTY_OWNER', 'SYSTEM_ADMIN')
  AND p."code" IN ('CONTRACT.READ', 'CONTRACT.MANAGE')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
