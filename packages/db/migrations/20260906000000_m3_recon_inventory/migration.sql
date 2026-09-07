-- M3 durable recon request accounting and per-audit endpoint snapshots.
CREATE TABLE "ReconRequestBudget" (
    "auditId" TEXT NOT NULL,
    "maxRequests" INTEGER NOT NULL,
    "reconLimit" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "consumed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ReconRequestBudget_pkey" PRIMARY KEY ("auditId"),
    CONSTRAINT "ReconRequestBudget_nonnegative_check" CHECK (
      "maxRequests" > 0 AND "reconLimit" > 0 AND
      "reserved" >= 0 AND "consumed" >= 0 AND
      "reconLimit" <= "maxRequests" AND
      "reserved" + "consumed" <= "reconLimit"
    )
);

ALTER TABLE "EndpointInventory"
  ADD COLUMN "auditId" TEXT NOT NULL,
  ADD COLUMN "projectId" TEXT NOT NULL,
  ADD COLUMN "targetId" TEXT NOT NULL,
  ADD COLUMN "previousInventoryId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'building',
  ADD COLUMN "endpointCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "addedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "removedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "changedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "generatedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "EndpointInventory_counts_check" CHECK (
    "endpointCount" >= 0 AND "addedCount" >= 0 AND "removedCount" >= 0 AND "changedCount" >= 0
  ),
  ADD CONSTRAINT "EndpointInventory_status_check" CHECK ("status" IN ('building', 'ready'));

ALTER TABLE "Endpoint"
  ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "technologies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "title" TEXT,
  ADD COLUMN "server" TEXT;

UPDATE "Endpoint" SET
  "rawExamples" = COALESCE("rawExamples", ARRAY[]::TEXT[]),
  "discoveredBy" = COALESCE("discoveredBy", ARRAY[]::TEXT[]),
  "statusObserved" = COALESCE("statusObserved", ARRAY[]::INTEGER[]);
ALTER TABLE "Endpoint"
  ALTER COLUMN "rawExamples" SET NOT NULL,
  ALTER COLUMN "discoveredBy" SET NOT NULL,
  ALTER COLUMN "statusObserved" SET NOT NULL,
  ALTER COLUMN "parameters" DROP DEFAULT,
  ALTER COLUMN "technologies" DROP DEFAULT;

CREATE TABLE "EndpointDrift" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "endpointKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "previousMetadata" JSONB,
    "currentMetadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EndpointDrift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EndpointDrift_kind_check" CHECK ("kind" IN ('added', 'removed', 'changed'))
);

CREATE UNIQUE INDEX "EndpointInventory_auditId_key" ON "EndpointInventory"("auditId");
CREATE INDEX "EndpointInventory_projectId_targetId_generatedAt_idx" ON "EndpointInventory"("projectId", "targetId", "generatedAt");
CREATE INDEX "EndpointInventory_previousInventoryId_idx" ON "EndpointInventory"("previousInventoryId");
CREATE UNIQUE INDEX "Endpoint_inventoryId_method_pathTemplate_key" ON "Endpoint"("inventoryId", "method", "pathTemplate");
CREATE INDEX "Endpoint_inventoryId_pathTemplate_idx" ON "Endpoint"("inventoryId", "pathTemplate");
CREATE UNIQUE INDEX "EndpointDrift_inventoryId_endpointKey_kind_key" ON "EndpointDrift"("inventoryId", "endpointKey", "kind");
CREATE INDEX "EndpointDrift_inventoryId_kind_idx" ON "EndpointDrift"("inventoryId", "kind");

ALTER TABLE "ReconRequestBudget" ADD CONSTRAINT "ReconRequestBudget_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EndpointInventory" ADD CONSTRAINT "EndpointInventory_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EndpointInventory" ADD CONSTRAINT "EndpointInventory_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EndpointInventory" ADD CONSTRAINT "EndpointInventory_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EndpointInventory" ADD CONSTRAINT "EndpointInventory_previousInventoryId_fkey"
  FOREIGN KEY ("previousInventoryId") REFERENCES "EndpointInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Endpoint" DROP CONSTRAINT "Endpoint_inventoryId_fkey";
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_inventoryId_fkey"
  FOREIGN KEY ("inventoryId") REFERENCES "EndpointInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EndpointDrift" ADD CONSTRAINT "EndpointDrift_inventoryId_fkey"
  FOREIGN KEY ("inventoryId") REFERENCES "EndpointInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
