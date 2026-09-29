-- DropForeignKey
ALTER TABLE "RouteMapping" DROP CONSTRAINT "RouteMapping_codeMapId_fkey";

-- AlterTable
ALTER TABLE "AuditJob" ADD COLUMN     "parentJobId" TEXT;
ALTER TABLE "AuditJob" ADD COLUMN "continuations" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CodeMap" ADD COLUMN     "auditId" TEXT,
ADD COLUMN     "commitSha" TEXT,
ADD COLUMN     "framework" TEXT,
ADD COLUMN     "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "legacy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "repositoryId" TEXT;

-- Existing M3 maps predate immutable audit provenance. They remain readable,
-- but every map created by the agent runtime must be bound to one audit,
-- project, repository, commit, and parser framework.
UPDATE "CodeMap"
SET "legacy" = true
WHERE "auditId" IS NULL
   OR "projectId" IS NULL
   OR "repositoryId" IS NULL
   OR "commitSha" IS NULL
   OR "framework" IS NULL;

-- CreateTable
CREATE TABLE "ModelCatalogEntry" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "catalogRevision" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "contextLimit" INTEGER NOT NULL,
    "outputLimit" INTEGER NOT NULL,
    "capabilities" TEXT[],
    "inputPricePerMToken" DECIMAL(10,6),
    "outputPricePerMToken" DECIMAL(10,6),
    "cachedPricePerMToken" DECIMAL(10,6),
    "status" TEXT NOT NULL DEFAULT 'available',
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAiConfiguration" (
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "catalogRevision" INTEGER NOT NULL,
    "credentialMode" TEXT NOT NULL,
    "credentialSecretId" TEXT,
    "budgetTotalTokens" INTEGER NOT NULL DEFAULT 2000000,
    "budgetMaxCalls" INTEGER NOT NULL DEFAULT 120,
    "budgetMaxContextBytes" INTEGER NOT NULL DEFAULT 400000,
    "budgetMaxOutputTokens" INTEGER NOT NULL DEFAULT 16000,
    "budgetBlackboxTokens" INTEGER NOT NULL DEFAULT 900000,
    "budgetBlackboxCalls" INTEGER NOT NULL DEFAULT 54,
    "budgetWhiteboxTokens" INTEGER NOT NULL DEFAULT 700000,
    "budgetWhiteboxCalls" INTEGER NOT NULL DEFAULT 42,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAiConfiguration_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "TestIdentity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "credentialSecretId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditAiSnapshot" (
    "auditId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "catalogRevision" INTEGER NOT NULL,
    "modelContextLimit" INTEGER NOT NULL,
    "modelOutputLimit" INTEGER NOT NULL,
    "credentialMode" TEXT NOT NULL,
    "credentialSecretId" TEXT,
    "credentialSecretVersion" INTEGER,
    "promptVersion" TEXT NOT NULL,
    "methodologyDigest" TEXT NOT NULL,
    "budgetTotalTokens" INTEGER NOT NULL,
    "budgetMaxCalls" INTEGER NOT NULL,
    "budgetMaxContextBytes" INTEGER NOT NULL,
    "budgetMaxOutputTokens" INTEGER NOT NULL,
    "budgetBlackboxTokens" INTEGER NOT NULL,
    "budgetBlackboxCalls" INTEGER NOT NULL,
    "budgetWhiteboxTokens" INTEGER NOT NULL,
    "budgetWhiteboxCalls" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditAiSnapshot_pkey" PRIMARY KEY ("auditId")
);

-- CreateTable
CREATE TABLE "AuditAiBudget" (
    "auditId" TEXT NOT NULL,
    "totalTokensLimit" INTEGER NOT NULL,
    "totalCallsLimit" INTEGER NOT NULL,
    "contextBytesLimit" INTEGER NOT NULL,
    "totalTokensConsumed" INTEGER NOT NULL DEFAULT 0,
    "totalCallsConsumed" INTEGER NOT NULL DEFAULT 0,
    "contextBytesConsumed" INTEGER NOT NULL DEFAULT 0,
    "totalTokensReserved" INTEGER NOT NULL DEFAULT 0,
    "totalCallsReserved" INTEGER NOT NULL DEFAULT 0,
    "bbTokensConsumed" INTEGER NOT NULL DEFAULT 0,
    "bbCallsConsumed" INTEGER NOT NULL DEFAULT 0,
    "bbTokensReserved" INTEGER NOT NULL DEFAULT 0,
    "bbCallsReserved" INTEGER NOT NULL DEFAULT 0,
    "wbTokensConsumed" INTEGER NOT NULL DEFAULT 0,
    "wbCallsConsumed" INTEGER NOT NULL DEFAULT 0,
    "wbTokensReserved" INTEGER NOT NULL DEFAULT 0,
    "wbCallsReserved" INTEGER NOT NULL DEFAULT 0,
    "degradationState" TEXT NOT NULL DEFAULT 'green',
    "degradedAt" TIMESTAMPTZ(3),
    "deadlineAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditAiBudget_pkey" PRIMARY KEY ("auditId")
);

-- CreateTable
CREATE TABLE "AiBudgetReservation" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "turnSequence" INTEGER NOT NULL,
    "callId" TEXT NOT NULL,
    "estimatedInput" INTEGER NOT NULL,
    "maxOutput" INTEGER NOT NULL,
    "contextBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "settledInput" INTEGER,
    "settledOutput" INTEGER,
    "settledCached" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "providerRequestId" TEXT,
    "stage" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "costUsd" DECIMAL(10,6),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "auditJobId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentTurn" INTEGER NOT NULL DEFAULT 0,
    "nextTurnSequence" INTEGER NOT NULL DEFAULT 0,
    "nextCallSequence" INTEGER NOT NULL DEFAULT 0,
    "currentTranscriptId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "terminalSummary" TEXT,
    "waitingForJobId" TEXT,
    "deadline" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTurn" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "turnSequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "transcriptEvidenceId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolInvocation" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "turnSequence" INTEGER NOT NULL,
    "callId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "argumentsValid" BOOLEAN NOT NULL,
    "validationErrors" TEXT[],
    "status" TEXT NOT NULL,
    "childJobId" TEXT,
    "resultEvidenceIds" TEXT[],
    "providerCallId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AgentToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCoverageResult" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "blockedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCoverageResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelCatalogEntry_provider_status_idx" ON "ModelCatalogEntry"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModelCatalogEntry_provider_modelId_catalogRevision_key" ON "ModelCatalogEntry"("provider", "modelId", "catalogRevision");

-- CreateIndex
CREATE INDEX "ProjectAiConfiguration_provider_modelId_idx" ON "ProjectAiConfiguration"("provider", "modelId");

-- CreateIndex
CREATE INDEX "TestIdentity_projectId_targetId_active_idx" ON "TestIdentity"("projectId", "targetId", "active");

-- CreateIndex
CREATE INDEX "AiBudgetReservation_auditId_status_idx" ON "AiBudgetReservation"("auditId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiBudgetReservation_auditId_agentRole_turnSequence_callId_key" ON "AiBudgetReservation"("auditId", "agentRole", "turnSequence", "callId");

-- CreateIndex
CREATE INDEX "AiUsage_auditId_stage_idx" ON "AiUsage"("auditId", "stage");

-- CreateIndex
CREATE INDEX "AgentRun_auditJobId_idx" ON "AgentRun"("auditJobId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_auditId_role_key" ON "AgentRun"("auditId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTurn_agentRunId_turnSequence_key" ON "AgentTurn"("agentRunId", "turnSequence");

-- CreateIndex
CREATE INDEX "AgentToolInvocation_childJobId_idx" ON "AgentToolInvocation"("childJobId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToolInvocation_agentRunId_turnSequence_callId_key" ON "AgentToolInvocation"("agentRunId", "turnSequence", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCoverageResult_auditId_agentRole_category_key" ON "AgentCoverageResult"("auditId", "agentRole", "category");

-- CreateIndex
CREATE INDEX "AuditJob_parentJobId_idx" ON "AuditJob"("parentJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeMap_auditId_key" ON "CodeMap"("auditId");

-- CreateIndex
CREATE INDEX "CodeMap_projectId_repositoryId_commitSha_framework_idx" ON "CodeMap"("projectId", "repositoryId", "commitSha", "framework");

-- CreateIndex
CREATE INDEX "CodeMap_projectId_idx" ON "CodeMap"("projectId");

-- This permits historical rows only when explicitly marked legacy; it blocks
-- new unscoped maps while allowing the nullable columns required for upgrade.
ALTER TABLE "CodeMap" ADD CONSTRAINT "CodeMap_runtime_provenance_check"
CHECK ("legacy" OR ("auditId" IS NOT NULL AND "projectId" IS NOT NULL
  AND "repositoryId" IS NOT NULL AND "commitSha" IS NOT NULL AND "framework" IS NOT NULL));

-- AddForeignKey
ALTER TABLE "AuditJob" ADD CONSTRAINT "AuditJob_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "AuditJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeMap" ADD CONSTRAINT "CodeMap_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteMapping" ADD CONSTRAINT "RouteMapping_codeMapId_fkey" FOREIGN KEY ("codeMapId") REFERENCES "CodeMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAiConfiguration" ADD CONSTRAINT "ProjectAiConfiguration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAiConfiguration" ADD CONSTRAINT "ProjectAiConfiguration_credentialSecretId_projectId_fkey" FOREIGN KEY ("credentialSecretId", "projectId") REFERENCES "Secret"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestIdentity" ADD CONSTRAINT "TestIdentity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestIdentity" ADD CONSTRAINT "TestIdentity_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestIdentity" ADD CONSTRAINT "TestIdentity_credentialSecretId_projectId_fkey" FOREIGN KEY ("credentialSecretId", "projectId") REFERENCES "Secret"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditAiSnapshot" ADD CONSTRAINT "AuditAiSnapshot_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditAiBudget" ADD CONSTRAINT "AuditAiBudget_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudgetReservation" ADD CONSTRAINT "AiBudgetReservation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTurn" ADD CONSTRAINT "AgentTurn_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTurn" ADD CONSTRAINT "AgentTurn_transcriptEvidenceId_fkey" FOREIGN KEY ("transcriptEvidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolInvocation" ADD CONSTRAINT "AgentToolInvocation_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolInvocation" ADD CONSTRAINT "AgentToolInvocation_childJobId_fkey" FOREIGN KEY ("childJobId") REFERENCES "AuditJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCoverageResult" ADD CONSTRAINT "AgentCoverageResult_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
