-- M3: durable request allocations are reclaimed when a worker lease expires.
CREATE TABLE "ReconRequestReservation" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "auditJobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "reservedCount" INTEGER NOT NULL,
    "consumedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ReconRequestReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReconRequestReservation_counts_check" CHECK (
      "reservedCount" > 0 AND "consumedCount" >= 0 AND "consumedCount" <= "reservedCount"
    ),
    CONSTRAINT "ReconRequestReservation_status_check" CHECK ("status" IN ('active', 'settled', 'reclaimed'))
);

CREATE UNIQUE INDEX "ReconRequestReservation_auditJobId_stage_key"
  ON "ReconRequestReservation"("auditJobId", "stage");
CREATE INDEX "ReconRequestReservation_auditId_status_leaseExpiresAt_idx"
  ON "ReconRequestReservation"("auditId", "status", "leaseExpiresAt");
CREATE INDEX "ReconRequestReservation_auditJobId_status_idx"
  ON "ReconRequestReservation"("auditJobId", "status");

ALTER TABLE "ReconRequestReservation" ADD CONSTRAINT "ReconRequestReservation_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconRequestReservation" ADD CONSTRAINT "ReconRequestReservation_auditJobId_fkey"
  FOREIGN KEY ("auditJobId") REFERENCES "AuditJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
