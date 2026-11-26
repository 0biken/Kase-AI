-- M5 G5/G6: dedup review queue and finding lifecycle decisions.

-- AlterTable: the human decision recorded on a lifecycle transition, and the
-- identity a confirmed POSSIBLE_MATCH was merged into.
ALTER TABLE "FindingIdentity" ADD COLUMN "statusChangedAt" TIMESTAMP(3),
ADD COLUMN "statusDecidedBy" TEXT,
ADD COLUMN "statusReason" TEXT,
ADD COLUMN "mergedIntoIdentityId" TEXT;

-- AlterTable: POSSIBLE_MATCH rows are the human review queue. Existing rows
-- predate the queue and are recorded as automatic.
ALTER TABLE "FindingRelation" ADD COLUMN "projectId" TEXT,
ADD COLUMN "level" INTEGER,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN "decidedBy" TEXT,
ADD COLUMN "decidedAt" TIMESTAMP(3),
ADD COLUMN "rationale" TEXT;

-- CreateIndex
CREATE INDEX "FindingRelation_projectId_kind_status_idx" ON "FindingRelation"("projectId", "kind", "status");
