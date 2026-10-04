-- CreateIndex
CREATE INDEX "Ticket_inventoryItemId_createdAt_id_idx" ON "Ticket"("inventoryItemId", "createdAt" DESC, "id");
