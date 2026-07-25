CREATE TYPE "VisitReservationStatus" AS ENUM (
    'REQUESTED',
    'ALTERNATIVE_PROPOSED',
    'CONFIRMED',
    'REJECTED',
    'ALTERNATIVE_DECLINED',
    'CANCELLED',
    'COMPLETED'
);

CREATE TYPE "VisitReservationAction" AS ENUM (
    'REQUESTED',
    'APPROVED',
    'REJECTED',
    'ALTERNATIVE_PROPOSED',
    'ALTERNATIVE_ACCEPTED',
    'ALTERNATIVE_DECLINED',
    'CANCELLED',
    'COMPLETED'
);

CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "visit_reservations" (
    "id" UUID NOT NULL,
    "reservation_number" TEXT NOT NULL,
    "property_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "broker_user_id" UUID NOT NULL,
    "status" "VisitReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_start_at" TIMESTAMPTZ(6) NOT NULL,
    "requested_end_at" TIMESTAMPTZ(6) NOT NULL,
    "alternative_start_at" TIMESTAMPTZ(6),
    "alternative_end_at" TIMESTAMPTZ(6),
    "alternative_expires_at" TIMESTAMPTZ(6),
    "confirmed_start_at" TIMESTAMPTZ(6),
    "confirmed_end_at" TIMESTAMPTZ(6),
    "request_message" TEXT,
    "response_message" TEXT,
    "cancellation_reason" TEXT,
    "responded_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "visit_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visit_reservation_histories" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "VisitReservationAction" NOT NULL,
    "previous_status" "VisitReservationStatus",
    "next_status" "VisitReservationStatus" NOT NULL,
    "note" TEXT,
    "start_at" TIMESTAMPTZ(6),
    "end_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visit_reservation_histories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visit_reservations_reservation_number_key"
ON "visit_reservations"("reservation_number");

CREATE UNIQUE INDEX "visit_reservations_active_request_key"
ON "visit_reservations"("property_id", "requester_id")
WHERE "status" IN ('REQUESTED', 'ALTERNATIVE_PROPOSED', 'CONFIRMED');

CREATE INDEX "visit_reservations_requester_id_status_created_at_idx"
ON "visit_reservations"("requester_id", "status", "created_at");
CREATE INDEX "visit_reservations_broker_user_id_status_requested_start_at_idx"
ON "visit_reservations"("broker_user_id", "status", "requested_start_at");
CREATE INDEX "visit_reservations_property_id_status_requested_start_at_idx"
ON "visit_reservations"("property_id", "status", "requested_start_at");
CREATE INDEX "visit_reservations_confirmed_start_at_confirmed_end_at_idx"
ON "visit_reservations"("confirmed_start_at", "confirmed_end_at");
CREATE INDEX "visit_reservation_histories_reservation_id_created_at_idx"
ON "visit_reservation_histories"("reservation_id", "created_at");
CREATE INDEX "notification_outbox_status_next_attempt_at_idx"
ON "notification_outbox"("status", "next_attempt_at");
CREATE INDEX "notification_outbox_recipient_user_id_created_at_idx"
ON "notification_outbox"("recipient_user_id", "created_at");
CREATE INDEX "notification_outbox_aggregate_type_aggregate_id_idx"
ON "notification_outbox"("aggregate_type", "aggregate_id");

ALTER TABLE "visit_reservations"
ADD CONSTRAINT "visit_reservations_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_reservations"
ADD CONSTRAINT "visit_reservations_requester_id_fkey"
FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_reservations"
ADD CONSTRAINT "visit_reservations_broker_user_id_fkey"
FOREIGN KEY ("broker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_reservation_histories"
ADD CONSTRAINT "visit_reservation_histories_reservation_id_fkey"
FOREIGN KEY ("reservation_id") REFERENCES "visit_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_reservation_histories"
ADD CONSTRAINT "visit_reservation_histories_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_outbox"
ADD CONSTRAINT "notification_outbox_recipient_user_id_fkey"
FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
