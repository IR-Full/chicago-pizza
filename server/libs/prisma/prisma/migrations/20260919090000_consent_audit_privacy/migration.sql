-- CreateEnum
CREATE TYPE "AdminAction" AS ENUM ('USER_ROLE_CHANGED', 'USER_BLOCKED', 'USER_UNBLOCKED', 'ORDER_STATUS_CHANGED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELISTED', 'CATEGORY_CREATED', 'PROMOCODE_CREATED', 'ACCOUNT_ERASED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "consentVersion" TEXT;

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "action" "AdminAction" NOT NULL,
    "actorId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_actorId_createdAt_idx" ON "admin_audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_targetType_targetId_idx" ON "admin_audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

