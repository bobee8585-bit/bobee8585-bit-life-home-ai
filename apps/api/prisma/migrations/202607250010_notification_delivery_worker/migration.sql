ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'PROCESSING' BEFORE 'SENT';

CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS');
CREATE TYPE "NotificationEndpointStatus" AS ENUM ('ACTIVE', 'INVALID', 'REVOKED');

ALTER TABLE "notification_outbox"
ADD COLUMN "delivery_channel" "NotificationChannel",
ADD COLUMN "delivery_provider" VARCHAR(40),
ADD COLUMN "provider_message_ids" JSONB,
ADD COLUMN "locked_at" TIMESTAMPTZ(6),
ADD COLUMN "lock_id" UUID;

ALTER TABLE "notification_outbox"
ALTER COLUMN "last_error" TYPE VARCHAR(240);

CREATE INDEX "notification_outbox_status_locked_at_idx"
ON "notification_outbox"("status", "locked_at");

CREATE TABLE "notification_endpoints" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "platform" "Platform",
    "provider" VARCHAR(40) NOT NULL,
    "destination_encrypted" TEXT NOT NULL,
    "destination_hash" VARCHAR(64) NOT NULL,
    "device_id_hash" VARCHAR(64),
    "locale" VARCHAR(20),
    "status" "NotificationEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "notification_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_endpoints_destination_hash_key"
ON "notification_endpoints"("destination_hash");
CREATE UNIQUE INDEX "notification_endpoints_user_id_channel_device_id_hash_key"
ON "notification_endpoints"("user_id", "channel", "device_id_hash");
CREATE INDEX "notification_endpoints_user_id_channel_status_idx"
ON "notification_endpoints"("user_id", "channel", "status");

ALTER TABLE "notification_endpoints"
ADD CONSTRAINT "notification_endpoints_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
