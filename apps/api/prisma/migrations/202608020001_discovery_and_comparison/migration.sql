CREATE TABLE "recent_property_views" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recent_property_views_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recent_property_views_user_id_property_id_key" ON "recent_property_views"("user_id", "property_id");
CREATE INDEX "recent_property_views_user_id_viewed_at_idx" ON "recent_property_views"("user_id", "viewed_at");
ALTER TABLE "recent_property_views" ADD CONSTRAINT "recent_property_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "recent_property_views" ADD CONSTRAINT "recent_property_views_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE;

CREATE TABLE "recent_property_searches" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "signature" VARCHAR(64) NOT NULL,
  "criteria" JSONB NOT NULL,
  "searched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recent_property_searches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recent_property_searches_user_id_signature_key" ON "recent_property_searches"("user_id", "signature");
CREATE INDEX "recent_property_searches_user_id_searched_at_idx" ON "recent_property_searches"("user_id", "searched_at");
ALTER TABLE "recent_property_searches" ADD CONSTRAINT "recent_property_searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE TABLE "property_comparison_items" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "property_comparison_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "property_comparison_items_user_id_property_id_key" ON "property_comparison_items"("user_id", "property_id");
CREATE UNIQUE INDEX "property_comparison_items_user_id_sort_order_key" ON "property_comparison_items"("user_id", "sort_order");
CREATE INDEX "property_comparison_items_user_id_updated_at_idx" ON "property_comparison_items"("user_id", "updated_at");
ALTER TABLE "property_comparison_items" ADD CONSTRAINT "property_comparison_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "property_comparison_items" ADD CONSTRAINT "property_comparison_items_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE;
