-- CreateEnum
CREATE TYPE "MediaUploadStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PropertyReportReason" AS ENUM ('FALSE_INFORMATION', 'DUPLICATE', 'UNAVAILABLE', 'FRAUD_SUSPECTED', 'ILLEGAL_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "property_media_uploads" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "property_media_id" UUID,
    "user_id" UUID NOT NULL,
    "media_type" "PropertyMediaType" NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "original_mime_type" TEXT NOT NULL,
    "original_size_bytes" BIGINT NOT NULL,
    "status" "MediaUploadStatus" NOT NULL DEFAULT 'REQUESTED',
    "storage_key" TEXT,
    "thumbnail_storage_key" TEXT,
    "output_mime_type" TEXT,
    "output_size_bytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" INTEGER,
    "error_code" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "property_media_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_reports" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" "PropertyReportReason" NOT NULL,
    "description" TEXT NOT NULL,
    "evidence_urls" TEXT[],
    "status" "PropertyReportStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "property_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_report_histories" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "previous_status" "PropertyReportStatus" NOT NULL,
    "next_status" "PropertyReportStatus" NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_report_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_media_uploads_property_media_id_key"
ON "property_media_uploads"("property_media_id");

-- CreateIndex
CREATE INDEX "property_media_uploads_property_id_status_created_at_idx"
ON "property_media_uploads"("property_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "property_media_uploads_user_id_created_at_idx"
ON "property_media_uploads"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "property_media_uploads_status_expires_at_idx"
ON "property_media_uploads"("status", "expires_at");

-- CreateIndex
CREATE INDEX "property_reports_status_created_at_idx"
ON "property_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "property_reports_property_id_status_idx"
ON "property_reports"("property_id", "status");

-- CreateIndex
CREATE INDEX "property_reports_reporter_id_created_at_idx"
ON "property_reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "property_report_histories_report_id_created_at_idx"
ON "property_report_histories"("report_id", "created_at");

-- AddForeignKey
ALTER TABLE "property_media_uploads"
ADD CONSTRAINT "property_media_uploads_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media_uploads"
ADD CONSTRAINT "property_media_uploads_property_media_id_fkey"
FOREIGN KEY ("property_media_id") REFERENCES "property_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media_uploads"
ADD CONSTRAINT "property_media_uploads_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_reports"
ADD CONSTRAINT "property_reports_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_reports"
ADD CONSTRAINT "property_reports_reporter_id_fkey"
FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_reports"
ADD CONSTRAINT "property_reports_assigned_to_fkey"
FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_report_histories"
ADD CONSTRAINT "property_report_histories_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "property_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_report_histories"
ADD CONSTRAINT "property_report_histories_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
