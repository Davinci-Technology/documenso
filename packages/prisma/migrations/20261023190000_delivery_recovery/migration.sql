ALTER TABLE "BackgroundJob" ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "leaseOwner" TEXT, ADD COLUMN "leaseExpiresAt" TIMESTAMP(3), ADD COLUMN "lastError" TEXT;
CREATE INDEX "BackgroundJob_status_availableAt_idx" ON "BackgroundJob"("status", "availableAt");
CREATE INDEX "BackgroundJob_status_leaseExpiresAt_idx" ON "BackgroundJob"("status", "leaseExpiresAt");
CREATE TABLE "EmailDelivery" (
 "id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT, "taskId" TEXT, "envelopeId" TEXT,
 "messageId" TEXT NOT NULL, "providerMessageId" TEXT, "status" TEXT NOT NULL DEFAULT 'SUBMITTING',
 "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "EmailDelivery_messageId_key" ON "EmailDelivery"("messageId");
CREATE INDEX "EmailDelivery_status_updatedAt_idx" ON "EmailDelivery"("status", "updatedAt");
CREATE INDEX "EmailDelivery_envelopeId_idx" ON "EmailDelivery"("envelopeId");
CREATE TABLE "EmailDeliveryEvent" (
 "id" TEXT NOT NULL PRIMARY KEY, "deliveryId" TEXT NOT NULL, "event" TEXT NOT NULL,
 "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmailDeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "EmailDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
