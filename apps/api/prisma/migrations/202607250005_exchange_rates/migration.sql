CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "base_currency" VARCHAR(3) NOT NULL,
    "quote_currency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "source_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_rates_base_currency_quote_currency_key"
ON "exchange_rates"("base_currency", "quote_currency");

CREATE INDEX "exchange_rates_expires_at_idx"
ON "exchange_rates"("expires_at");

CREATE INDEX "exchange_rates_provider_source_timestamp_idx"
ON "exchange_rates"("provider", "source_timestamp");
