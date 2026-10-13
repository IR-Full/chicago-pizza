ALTER TABLE "ticket_messages" ADD COLUMN "clientMessageId" TEXT;
CREATE UNIQUE INDEX "ticket_messages_ticketId_senderId_clientMessageId_key"
ON "ticket_messages"("ticketId", "senderId", "clientMessageId");
