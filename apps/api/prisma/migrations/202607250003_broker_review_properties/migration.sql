-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'VILLA', 'OFFICETEL', 'DETACHED_HOUSE', 'MULTIFAMILY_HOUSE', 'COMMERCIAL', 'LAND');

-- CreateEnum
CREATE TYPE "PropertyTransactionType" AS ENUM ('SALE', 'JEONSE', 'MONTHLY_RENT');

-- CreateEnum
CREATE TYPE "PropertyMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "listing_number" TEXT NOT NULL,
    "broker_user_id" UUID NOT NULL,
    "brokerage_office_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "property_type" "PropertyType" NOT NULL,
    "transaction_type" "PropertyTransactionType" NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "deposit" DECIMAL(18,2),
    "monthly_rent" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "exclusive_area" DECIMAL(10,2) NOT NULL,
    "supply_area" DECIMAL(10,2),
    "rooms" INTEGER NOT NULL,
    "bathrooms" INTEGER NOT NULL,
    "floor" INTEGER,
    "total_floors" INTEGER,
    "country_code" TEXT NOT NULL DEFAULT 'KR',
    "region1" TEXT NOT NULL,
    "region2" TEXT,
    "city" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_media" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "type" "PropertyMediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "properties_listing_number_key" ON "properties"("listing_number");

-- CreateIndex
CREATE INDEX "properties_status_created_at_idx" ON "properties"("status", "created_at");

-- CreateIndex
CREATE INDEX "properties_city_property_type_transaction_type_status_idx"
ON "properties"("city", "property_type", "transaction_type", "status");

-- CreateIndex
CREATE INDEX "properties_broker_user_id_status_updated_at_idx"
ON "properties"("broker_user_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "properties_brokerage_office_id_status_idx"
ON "properties"("brokerage_office_id", "status");

-- CreateIndex
CREATE INDEX "property_media_property_id_type_is_public_sort_order_idx"
ON "property_media"("property_id", "type", "is_public", "sort_order");

-- AddForeignKey
ALTER TABLE "properties"
ADD CONSTRAINT "properties_broker_user_id_fkey"
FOREIGN KEY ("broker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"
ADD CONSTRAINT "properties_brokerage_office_id_fkey"
FOREIGN KEY ("brokerage_office_id") REFERENCES "brokerage_offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"
ADD CONSTRAINT "properties_reviewed_by_fkey"
FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media"
ADD CONSTRAINT "property_media_property_id_fkey"
FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
