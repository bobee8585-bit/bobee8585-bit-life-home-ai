ALTER TYPE "PaymentTransactionStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

CREATE INDEX "payment_transactions_refund_processing_idx"
ON "payment_transactions"("type", "status", "updated_at");
