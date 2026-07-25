CREATE TYPE "ReservationDepositStatus" AS ENUM (
    'READY',
    'PAID',
    'REFUND_PENDING',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'FAILED',
    'CANCELLED'
);

CREATE TYPE "PaymentTransactionType" AS ENUM ('PREPARE', 'CAPTURE', 'REFUND');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ReservationRefundReason" AS ENUM (
    'USER_CANCELLATION',
    'BROKER_CANCELLATION',
    'PROPERTY_UNAVAILABLE',
    'ADMIN_OVERRIDE'
);

CREATE TABLE "reservation_deposits" (
    "id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "reservation_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "ReservationDepositStatus" NOT NULL DEFAULT 'READY',
    "provider" VARCHAR(40) NOT NULL,
    "provider_payment_reference" TEXT,
    "prepare_idempotency_key" VARCHAR(100) NOT NULL,
    "policy_version" VARCHAR(40) NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "refunded_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retained_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(6),
    "refund_requested_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "failure_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "reservation_deposits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "deposit_id" UUID NOT NULL,
    "type" "PaymentTransactionType" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "provider_transaction_id" VARCHAR(120),
    "refund_reason" "ReservationRefundReason",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(80),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reservation_deposits_payment_number_key"
ON "reservation_deposits"("payment_number");
CREATE UNIQUE INDEX "reservation_deposits_reservation_id_key"
ON "reservation_deposits"("reservation_id");
CREATE UNIQUE INDEX "reservation_deposits_provider_payment_reference_key"
ON "reservation_deposits"("provider_payment_reference");
CREATE UNIQUE INDEX "reservation_deposits_prepare_idempotency_key_key"
ON "reservation_deposits"("prepare_idempotency_key");
CREATE INDEX "reservation_deposits_payer_id_status_created_at_idx"
ON "reservation_deposits"("payer_id", "status", "created_at");
CREATE INDEX "reservation_deposits_status_refund_requested_at_idx"
ON "reservation_deposits"("status", "refund_requested_at");

CREATE UNIQUE INDEX "payment_transactions_idempotency_key_key"
ON "payment_transactions"("idempotency_key");
CREATE UNIQUE INDEX "payment_transactions_provider_transaction_id_key"
ON "payment_transactions"("provider_transaction_id");
CREATE INDEX "payment_transactions_deposit_id_type_status_created_at_idx"
ON "payment_transactions"("deposit_id", "type", "status", "created_at");
CREATE INDEX "payment_transactions_status_requested_at_idx"
ON "payment_transactions"("status", "requested_at");

ALTER TABLE "reservation_deposits"
ADD CONSTRAINT "reservation_deposits_reservation_id_fkey"
FOREIGN KEY ("reservation_id") REFERENCES "visit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservation_deposits"
ADD CONSTRAINT "reservation_deposits_payer_id_fkey"
FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_transactions"
ADD CONSTRAINT "payment_transactions_deposit_id_fkey"
FOREIGN KEY ("deposit_id") REFERENCES "reservation_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
