-- M2 deterministic spine: durable orchestration, ordered events, evidence
-- tombstones, project-scoped finding identity, and retention authorization.

-- Audit graph and cancellation state.
ALTER TABLE "Audit"
  ADD COLUMN "repositoryId" TEXT,
  ADD COLUMN "requestedCommitSha" TEXT,
  ADD COLUMN "cancellationRequestedAt" TIMESTAMPTZ(3);

ALTER TABLE "AuditJob"
  ADD COLUMN "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
  ADD COLUMN "maxRetries" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "enqueuedAt" TIMESTAMPTZ(3),
  ADD COLUMN "heartbeatAt" TIMESTAMPTZ(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "errorClass" TEXT;

-- New jobs must snapshot an adapter timeout rather than inherit a mutable
-- default. The temporary default above only makes the migration safe for M1
-- rows that predate timeout snapshots.
ALTER TABLE "AuditJob" ALTER COLUMN "timeoutMs" DROP DEFAULT;

ALTER TABLE "AuditJob"
  ADD CONSTRAINT "AuditJob_timeoutMs_check" CHECK ("timeoutMs" > 0),
  ADD CONSTRAINT "AuditJob_maxRetries_check" CHECK ("maxRetries" BETWEEN 0 AND 2),
  ADD CONSTRAINT "AuditJob_attempts_check" CHECK ("attempts" >= 0);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditEvent_auditId_sequence_key"
  ON "AuditEvent"("auditId", "sequence");
CREATE INDEX "AuditEvent_auditId_createdAt_idx"
  ON "AuditEvent"("auditId", "createdAt");
CREATE INDEX "AuditJob_auditId_status_idx"
  ON "AuditJob"("auditId", "status");
CREATE INDEX "AuditJob_leaseExpiresAt_idx"
  ON "AuditJob"("leaseExpiresAt");
CREATE INDEX "Audit_repositoryId_idx" ON "Audit"("repositoryId");
CREATE UNIQUE INDEX "BuildProvenance_auditId_key" ON "BuildProvenance"("auditId");

ALTER TABLE "BuildProvenance" ADD CONSTRAINT "BuildProvenance_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_auditId_fkey"
  FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidence integrity facts survive hard deletion of object bytes.
ALTER TABLE "Evidence"
  ALTER COLUMN "artifactUri" DROP NOT NULL,
  ADD COLUMN "fullRedactedSha256" TEXT,
  ADD COLUMN "truncated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "objectDeletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "tombstonedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deletionLeaseId" TEXT,
  ADD COLUMN "deletionLeaseExpiresAt" TIMESTAMPTZ(3);

-- Existing M1 captures receive the platform default. Replayable evidence is
-- committed for 90 days; all other evidence is committed for 30 days.
UPDATE "Evidence"
SET "expiresAt" = "capturedAt" +
  CASE WHEN "replayable" THEN INTERVAL '90 days' ELSE INTERVAL '30 days' END
WHERE "expiresAt" IS NULL;
ALTER TABLE "Evidence" ALTER COLUMN "expiresAt" SET NOT NULL;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_sizeBytes_check" CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "Evidence_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Evidence_tombstone_check" CHECK (
    "tombstonedAt" IS NULL OR
    ("artifactUri" IS NULL AND "objectDeletedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "Evidence_deletionLease_check" CHECK (
    ("deletionLeaseId" IS NULL) = ("deletionLeaseExpiresAt" IS NULL)
  );

CREATE INDEX "Evidence_auditId_type_idx" ON "Evidence"("auditId", "type");
CREATE INDEX "Evidence_live_expiry_idx" ON "Evidence"("expiresAt")
  WHERE "tombstonedAt" IS NULL;

-- Fingerprints are project-scoped: identical normalized findings in separate
-- tenants must not collide.
DROP INDEX "FindingIdentity_fingerprint_key";
CREATE UNIQUE INDEX "FindingIdentity_projectId_fingerprint_key"
  ON "FindingIdentity"("projectId", "fingerprint");
CREATE INDEX "FindingIdentity_projectId_status_currentSeverity_idx"
  ON "FindingIdentity"("projectId", "status", "currentSeverity");
CREATE UNIQUE INDEX "Finding_auditId_identityId_key"
  ON "Finding"("auditId", "identityId");
CREATE INDEX "Finding_auditId_category_severity_idx"
  ON "Finding"("auditId", "category", "severity");

-- Organization membership is separate from project roles. Existing users
-- are backfilled as organization admins to preserve the pre-M2 authority they
-- already held through User.organizationId.
CREATE TABLE "OrganizationMember" (
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("userId", "organizationId"),
  CONSTRAINT "OrganizationMember_role_check" CHECK ("role" IN ('member', 'admin'))
);

INSERT INTO "OrganizationMember" ("userId", "organizationId", "role")
SELECT "id", "organizationId", 'admin' FROM "User"
ON CONFLICT ("userId", "organizationId") DO NOTHING;

CREATE INDEX "OrganizationMember_organizationId_role_idx"
  ON "OrganizationMember"("organizationId", "role");
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EvidenceRetentionPolicy" (
  "organizationId" TEXT NOT NULL,
  "replayableEvidenceDays" INTEGER NOT NULL DEFAULT 90,
  "nonReplayableEvidenceDays" INTEGER NOT NULL DEFAULT 30,
  "rawToolOutputDays" INTEGER NOT NULL DEFAULT 30,
  "agentTranscriptDays" INTEGER NOT NULL DEFAULT 30,
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "EvidenceRetentionPolicy_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "EvidenceRetentionPolicy_replayable_days_check" CHECK ("replayableEvidenceDays" BETWEEN 1 AND 365),
  CONSTRAINT "EvidenceRetentionPolicy_non_replayable_days_check" CHECK ("nonReplayableEvidenceDays" BETWEEN 1 AND 365),
  CONSTRAINT "EvidenceRetentionPolicy_raw_tool_days_check" CHECK ("rawToolOutputDays" BETWEEN 1 AND 365),
  CONSTRAINT "EvidenceRetentionPolicy_agent_transcript_days_check" CHECK ("agentTranscriptDays" BETWEEN 1 AND 365)
);

CREATE TABLE "ProjectEvidenceRetentionOverride" (
  "projectId" TEXT NOT NULL,
  "replayableEvidenceDays" INTEGER,
  "nonReplayableEvidenceDays" INTEGER,
  "rawToolOutputDays" INTEGER,
  "agentTranscriptDays" INTEGER,
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectEvidenceRetentionOverride_pkey" PRIMARY KEY ("projectId"),
  CONSTRAINT "ProjectEvidenceRetentionOverride_replayable_days_check" CHECK ("replayableEvidenceDays" IS NULL OR "replayableEvidenceDays" BETWEEN 1 AND 365),
  CONSTRAINT "ProjectEvidenceRetentionOverride_non_replayable_days_check" CHECK ("nonReplayableEvidenceDays" IS NULL OR "nonReplayableEvidenceDays" BETWEEN 1 AND 365),
  CONSTRAINT "ProjectEvidenceRetentionOverride_raw_tool_days_check" CHECK ("rawToolOutputDays" IS NULL OR "rawToolOutputDays" BETWEEN 1 AND 365),
  CONSTRAINT "ProjectEvidenceRetentionOverride_agent_transcript_days_check" CHECK ("agentTranscriptDays" IS NULL OR "agentTranscriptDays" BETWEEN 1 AND 365)
);

ALTER TABLE "EvidenceRetentionPolicy" ADD CONSTRAINT "EvidenceRetentionPolicy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectEvidenceRetentionOverride" ADD CONSTRAINT "ProjectEvidenceRetentionOverride_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convert orchestration/retention timestamps touched by M2 to timezone-aware
-- values. Existing values are interpreted as UTC, matching the service's
-- historical storage convention.
ALTER TABLE "Audit"
  ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING "completedAt" AT TIME ZONE 'UTC';
ALTER TABLE "AuditJob"
  ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finishedAt" TYPE TIMESTAMPTZ(3) USING "finishedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Evidence"
  ALTER COLUMN "capturedAt" TYPE TIMESTAMPTZ(3) USING "capturedAt" AT TIME ZONE 'UTC';
