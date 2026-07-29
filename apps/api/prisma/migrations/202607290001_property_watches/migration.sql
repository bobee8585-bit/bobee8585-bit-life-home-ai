CREATE TYPE "PropertyDealStatus" AS ENUM (
  'AVAILABLE',
  'RESERVED',
  'CONTRACTING',
  'COMPLETED',
  'WITHDRAWN'
);

CREATE TYPE "PropertyChangeType" AS ENUM (
  'PRICE',
  'PHOTO',
  'DEAL_STATUS'
);

ALTER TABLE "properties"
ADD COLUMN "deal_status" "PropertyDealStatus" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "properties"
ADD CONSTRAINT "properties_terminal_deal_status_check"
CHECK (
  "deal_status" NOT IN ('COMPLETED', 'WITHDRAWN')
  OR "status" = 'INACTIVE'
);

CREATE TABLE "property_watches" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "alert_on_price_change" BOOLEAN NOT NULL DEFAULT true,
  "alert_on_photo_change" BOOLEAN NOT NULL DEFAULT true,
  "alert_on_deal_status_change" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "property_watches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "property_change_events" (
  "id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "type" "PropertyChangeType" NOT NULL,
  "before_data" JSONB,
  "after_data" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_change_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "property_watch_alerts" (
  "id" UUID NOT NULL,
  "property_watch_id" UUID NOT NULL,
  "change_event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_watch_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "property_watches_user_id_property_id_key"
ON "property_watches"("user_id", "property_id");
CREATE INDEX "property_watches_user_id_updated_at_idx"
ON "property_watches"("user_id", "updated_at");
CREATE INDEX "property_watches_property_id_created_at_idx"
ON "property_watches"("property_id", "created_at");

CREATE INDEX "property_change_events_property_id_created_at_idx"
ON "property_change_events"("property_id", "created_at");
CREATE INDEX "property_change_events_actor_user_id_created_at_idx"
ON "property_change_events"("actor_user_id", "created_at");

CREATE UNIQUE INDEX "property_watch_alerts_property_watch_id_change_event_id_key"
ON "property_watch_alerts"("property_watch_id", "change_event_id");
CREATE INDEX "property_watch_alerts_change_event_id_created_at_idx"
ON "property_watch_alerts"("change_event_id", "created_at");

ALTER TABLE "property_watches"
ADD CONSTRAINT "property_watches_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_watches"
ADD CONSTRAINT "property_watches_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_change_events"
ADD CONSTRAINT "property_change_events_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_change_events"
ADD CONSTRAINT "property_change_events_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "property_watch_alerts"
ADD CONSTRAINT "property_watch_alerts_property_watch_id_fkey"
FOREIGN KEY ("property_watch_id") REFERENCES "property_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "property_watch_alerts"
ADD CONSTRAINT "property_watch_alerts_change_event_id_fkey"
FOREIGN KEY ("change_event_id") REFERENCES "property_change_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "name")
VALUES (
  '019d1f00-0000-7000-8000-000000000001',
  'PROPERTY.WATCH',
  '관심 매물·변경 알림 관리'
)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" IN (
  'GENERAL_USER',
  'PROPERTY_OWNER',
  'BROKER',
  'BROKER_MANAGER',
  'SYSTEM_ADMIN'
)
  AND p."code" = 'PROPERTY.WATCH'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

UPDATE "menus"
SET "api_scope" = 'PROPERTY.WATCH'
WHERE "code" = 'PROPERTY_FAVORITES';
