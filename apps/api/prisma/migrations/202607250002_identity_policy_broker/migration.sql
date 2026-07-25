-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFY', 'PHONE_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "BrokerageStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BrokerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateTable
CREATE TABLE "verification_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "channel" "VerificationChannel" NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "destination_hash" TEXT NOT NULL,
    "destination_encrypted" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brokerage_offices" (
    "id" UUID NOT NULL,
    "business_registration_no" TEXT NOT NULL,
    "brokerage_registration_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "representative_name_encrypted" TEXT NOT NULL,
    "phone_country_code" TEXT NOT NULL,
    "phone_number_encrypted" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "status" "BrokerageStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brokerage_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_profiles" (
    "user_id" UUID NOT NULL,
    "brokerage_office_id" UUID NOT NULL,
    "license_number" TEXT NOT NULL,
    "legal_name_encrypted" TEXT NOT NULL,
    "status" "BrokerStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "broker_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "verification_challenges_user_id_purpose_consumed_at_expires_idx"
ON "verification_challenges"("user_id", "purpose", "consumed_at", "expires_at");

-- CreateIndex
CREATE INDEX "verification_challenges_destination_hash_purpose_created_a_idx"
ON "verification_challenges"("destination_hash", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_offices_business_registration_no_key"
ON "brokerage_offices"("business_registration_no");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_offices_brokerage_registration_no_key"
ON "brokerage_offices"("brokerage_registration_no");

-- CreateIndex
CREATE INDEX "brokerage_offices_status_created_at_idx"
ON "brokerage_offices"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "broker_profiles_license_number_key"
ON "broker_profiles"("license_number");

-- CreateIndex
CREATE INDEX "broker_profiles_brokerage_office_id_status_idx"
ON "broker_profiles"("brokerage_office_id", "status");

-- AddForeignKey
ALTER TABLE "verification_challenges"
ADD CONSTRAINT "verification_challenges_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_profiles"
ADD CONSTRAINT "broker_profiles_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_profiles"
ADD CONSTRAINT "broker_profiles_brokerage_office_id_fkey"
FOREIGN KEY ("brokerage_office_id") REFERENCES "brokerage_offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
