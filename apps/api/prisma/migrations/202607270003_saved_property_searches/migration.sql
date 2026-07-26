CREATE TABLE "saved_property_searches" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "city" VARCHAR(80),
  "property_type" "PropertyType",
  "transaction_type" "PropertyTransactionType",
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KRW',
  "min_price" DECIMAL(18,2),
  "max_price" DECIMAL(18,2),
  "min_rooms" INTEGER,
  "alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "saved_property_searches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saved_property_searches_price_check" CHECK (
    ("min_price" IS NULL OR "min_price" >= 0)
    AND ("max_price" IS NULL OR "max_price" >= 0)
    AND ("min_price" IS NULL OR "max_price" IS NULL OR "min_price" <= "max_price")
  ),
  CONSTRAINT "saved_property_searches_rooms_check" CHECK (
    "min_rooms" IS NULL OR "min_rooms" BETWEEN 0 AND 100
  ),
  CONSTRAINT "saved_property_searches_currency_check" CHECK (
    "currency" ~ '^[A-Z]{3}$'
  )
);

CREATE TABLE "saved_property_alerts" (
  "id" UUID NOT NULL,
  "saved_search_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_property_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_property_searches_user_id_name_key"
ON "saved_property_searches"("user_id", "name");
CREATE INDEX "saved_property_searches_user_id_updated_at_idx"
ON "saved_property_searches"("user_id", "updated_at");
CREATE INDEX "saved_property_searches_alerts_enabled_city_property_type_transaction_type_idx"
ON "saved_property_searches"("alerts_enabled", "city", "property_type", "transaction_type");
CREATE UNIQUE INDEX "saved_property_alerts_saved_search_id_property_id_key"
ON "saved_property_alerts"("saved_search_id", "property_id");
CREATE INDEX "saved_property_alerts_property_id_created_at_idx"
ON "saved_property_alerts"("property_id", "created_at");

ALTER TABLE "saved_property_searches"
ADD CONSTRAINT "saved_property_searches_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_property_alerts"
ADD CONSTRAINT "saved_property_alerts_saved_search_id_fkey"
FOREIGN KEY ("saved_search_id") REFERENCES "saved_property_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_property_alerts"
ADD CONSTRAINT "saved_property_alerts_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
