-- CreateIndex
CREATE INDEX "ActivityLog_serviceStartedAt_createdAt_id_idx" ON "ActivityLog"("serviceStartedAt" DESC, "createdAt" DESC, "id");
