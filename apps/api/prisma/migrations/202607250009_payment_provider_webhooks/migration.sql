CREATE TYPE "PaymentWebhookEventStatus" AS ENUM (
  'RECEIVED',
  'PROCESSED',
  'IGNORED',
  'FAILED'
);

CREATE TABLE "payment_webhook_events" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "transmission_id" VARCHAR(200) NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "status" "PaymentWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "deposit_id" UUID,
  "payment_reference" VARCHAR(200),
  "order_id" VARCHAR(64),
  "payload_hash" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "failure_code" VARCHAR(80),
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_webhook_events_deposit_id_fkey"
    FOREIGN KEY ("deposit_id")
    REFERENCES "reservation_deposits"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_webhook_events_provider_transmission_id_key"
  ON "payment_webhook_events"("provider", "transmission_id");
CREATE INDEX "payment_webhook_events_status_received_at_idx"
  ON "payment_webhook_events"("status", "received_at");
CREATE INDEX "payment_webhook_events_deposit_id_received_at_idx"
  ON "payment_webhook_events"("deposit_id", "received_at");
CREATE INDEX "payment_webhook_events_payment_reference_idx"
  ON "payment_webhook_events"("payment_reference");
