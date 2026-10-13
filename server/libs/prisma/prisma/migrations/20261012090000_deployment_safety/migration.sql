ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "orders_userId_idempotencyKey_key" ON "orders"("userId", "idempotencyKey");
ALTER TABLE "payments" ADD COLUMN "providerRefundId" TEXT, ADD COLUMN "refundStatus" TEXT;
CREATE UNIQUE INDEX "payments_providerRefundId_key" ON "payments"("providerRefundId");
ALTER TABLE "notifications" ADD COLUMN "eventId" TEXT;
CREATE UNIQUE INDEX "notifications_eventId_key" ON "notifications"("eventId");
CREATE TABLE "event_outbox" (
 "sequence" BIGSERIAL UNIQUE, "id" TEXT PRIMARY KEY, "event" TEXT NOT NULL, "payload" JSONB NOT NULL, "destination" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMP(3),
 "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3), "leaseOwner" TEXT, "lastError" TEXT
);
CREATE INDEX "event_outbox_deliveredAt_nextAttemptAt_idx" ON "event_outbox"("deliveredAt", "nextAttemptAt");
