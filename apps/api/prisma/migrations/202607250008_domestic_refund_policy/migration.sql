ALTER TABLE "reservation_deposits"
ADD COLUMN "refund_due_at" TIMESTAMPTZ(6);

CREATE INDEX "reservation_deposits_status_refund_due_at_idx"
ON "reservation_deposits"("status", "refund_due_at");

UPDATE "reservation_deposits"
SET
    "policy_version" = '2026-07-v2',
    "policy_snapshot" = jsonb_set(
        jsonb_set(
            "policy_snapshot",
            '{userCancellationRefundRate}',
            '"1"',
            true
        ),
        '{cardFeePassedToConsumer}',
        'false',
        true
    ),
    "refunded_amount" = CASE
        WHEN "status" = 'REFUND_PENDING' THEN "amount"
        ELSE "refunded_amount"
    END,
    "retained_amount" = CASE
        WHEN "status" = 'REFUND_PENDING' THEN 0
        ELSE "retained_amount"
    END,
    "refund_due_at" = CASE
        WHEN "status" = 'REFUND_PENDING' THEN CURRENT_TIMESTAMP + INTERVAL '3 days'
        ELSE "refund_due_at"
    END
WHERE "status" IN ('READY', 'PAID', 'REFUND_PENDING');

UPDATE "payment_transactions" AS transaction
SET "amount" = deposit."amount"
FROM "reservation_deposits" AS deposit
WHERE transaction."deposit_id" = deposit."id"
  AND transaction."type" = 'REFUND'
  AND transaction."refund_reason" = 'USER_CANCELLATION'
  AND transaction."status" IN ('PENDING', 'FAILED')
  AND deposit."status" = 'REFUND_PENDING';

INSERT INTO "payment_transactions" (
    "id",
    "deposit_id",
    "type",
    "status",
    "amount",
    "currency",
    "idempotency_key",
    "refund_reason",
    "attempts",
    "requested_at",
    "created_at",
    "updated_at"
)
SELECT
    md5('refund-correction:' || deposit."id"::text)::uuid,
    deposit."id",
    'REFUND',
    'PENDING',
    deposit."retained_amount",
    deposit."currency",
    'refund-correction:' || deposit."id"::text,
    'USER_CANCELLATION',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "reservation_deposits" AS deposit
WHERE deposit."status" = 'PARTIALLY_REFUNDED'
  AND deposit."retained_amount" > 0
ON CONFLICT ("idempotency_key") DO NOTHING;

UPDATE "reservation_deposits"
SET
    "status" = 'REFUND_PENDING',
    "policy_version" = '2026-07-v2',
    "policy_snapshot" = jsonb_set(
        jsonb_set(
            "policy_snapshot",
            '{userCancellationRefundRate}',
            '"1"',
            true
        ),
        '{cardFeePassedToConsumer}',
        'false',
        true
    ),
    "refunded_amount" = "amount",
    "retained_amount" = 0,
    "refund_requested_at" = CURRENT_TIMESTAMP,
    "refund_due_at" = CURRENT_TIMESTAMP + INTERVAL '3 days'
WHERE "status" = 'PARTIALLY_REFUNDED'
  AND "retained_amount" > 0;
