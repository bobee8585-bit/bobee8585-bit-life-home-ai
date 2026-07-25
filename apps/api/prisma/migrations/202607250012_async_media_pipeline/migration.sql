-- Add asynchronous media pipeline state.
ALTER TABLE "property_media_uploads"
ADD COLUMN "requested_is_public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "requested_sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "original_storage_key" TEXT,
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "queued_at" TIMESTAMPTZ(6),
ADD COLUMN "processing_started_at" TIMESTAMPTZ(6),
ADD COLUMN "completed_at" TIMESTAMPTZ(6);

-- Preserve the request attributes of media that was processed synchronously
-- before this migration.
UPDATE "property_media_uploads" AS upload
SET
  "requested_is_public" = media."is_public",
  "requested_sort_order" = media."sort_order",
  "queued_at" = upload."created_at",
  "processing_started_at" = upload."created_at",
  "completed_at" = CASE
    WHEN upload."status" IN ('READY', 'FAILED') THEN upload."updated_at"
    ELSE NULL
  END
FROM "property_media" AS media
WHERE upload."property_media_id" = media."id";

ALTER TABLE "property_media_uploads"
ADD CONSTRAINT "property_media_uploads_requested_sort_order_check"
CHECK ("requested_sort_order" BETWEEN 0 AND 100),
ADD CONSTRAINT "property_media_uploads_attempts_check"
CHECK ("attempts" >= 0);

CREATE INDEX "property_media_uploads_status_queued_at_idx"
ON "property_media_uploads"("status", "queued_at");
