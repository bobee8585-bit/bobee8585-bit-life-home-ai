CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'SYSTEM');

ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'SKIPPED' AFTER 'SENT';

ALTER TABLE "notification_outbox"
ADD COLUMN "sms_fallback_allowed" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "property_chat_rooms" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "member_user_id" UUID NOT NULL,
    "registrant_user_id" UUID NOT NULL,
    "last_message_sequence" INTEGER NOT NULL DEFAULT 0,
    "member_last_read_sequence" INTEGER NOT NULL DEFAULT 0,
    "registrant_last_read_sequence" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "property_chat_rooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "property_chat_rooms_distinct_participants_check"
      CHECK ("member_user_id" <> "registrant_user_id"),
    CONSTRAINT "property_chat_rooms_sequence_check"
      CHECK (
        "last_message_sequence" >= 0
        AND "member_last_read_sequence" BETWEEN 0 AND "last_message_sequence"
        AND "registrant_last_read_sequence" BETWEEN 0 AND "last_message_sequence"
      )
);

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "chat_room_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "client_message_id" VARCHAR(64) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_messages_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "chat_messages_body_check" CHECK (char_length(btrim("body")) BETWEEN 1 AND 2000)
);

CREATE UNIQUE INDEX "property_chat_rooms_property_id_member_user_id_key"
ON "property_chat_rooms"("property_id", "member_user_id");
CREATE INDEX "property_chat_rooms_member_user_id_last_message_at_idx"
ON "property_chat_rooms"("member_user_id", "last_message_at");
CREATE INDEX "property_chat_rooms_registrant_user_id_last_message_at_idx"
ON "property_chat_rooms"("registrant_user_id", "last_message_at");
CREATE INDEX "property_chat_rooms_property_id_last_message_at_idx"
ON "property_chat_rooms"("property_id", "last_message_at");

CREATE UNIQUE INDEX "chat_messages_chat_room_id_sequence_key"
ON "chat_messages"("chat_room_id", "sequence");
CREATE UNIQUE INDEX "chat_messages_chat_room_id_sender_user_id_client_message_id_key"
ON "chat_messages"("chat_room_id", "sender_user_id", "client_message_id");
CREATE INDEX "chat_messages_chat_room_id_created_at_idx"
ON "chat_messages"("chat_room_id", "created_at");
CREATE INDEX "chat_messages_sender_user_id_created_at_idx"
ON "chat_messages"("sender_user_id", "created_at");

ALTER TABLE "property_chat_rooms"
ADD CONSTRAINT "property_chat_rooms_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "property_chat_rooms"
ADD CONSTRAINT "property_chat_rooms_member_user_id_fkey"
FOREIGN KEY ("member_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "property_chat_rooms"
ADD CONSTRAINT "property_chat_rooms_registrant_user_id_fkey"
FOREIGN KEY ("registrant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_chat_room_id_fkey"
FOREIGN KEY ("chat_room_id") REFERENCES "property_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_sender_user_id_fkey"
FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
