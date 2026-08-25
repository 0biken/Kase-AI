-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultGatePolicyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "credentialId" TEXT,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "authCredentialId" TEXT,
    "buildInfoUrl" TEXT,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopePolicy" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "allowedHosts" TEXT[],
    "deniedPaths" TEXT[],
    "maxRequestsPerSecond" INTEGER NOT NULL,
    "maxRequestsPerAudit" INTEGER NOT NULL,
    "destructiveAllowed" BOOLEAN NOT NULL DEFAULT false,
    "authorizationAttestedBy" TEXT NOT NULL,
    "authorizationAttestedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "degradationReasons" TEXT[],
    "requestedCategories" TEXT[],
    "executedCategories" TEXT[],
    "notExecutedCategories" JSONB NOT NULL,
    "buildProvenanceId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildProvenance" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "commitSha" TEXT,
    "branch" TEXT,
    "buildId" TEXT,
    "source" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "targetFingerprint" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditJob" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL,
    "dependsOn" TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "AuditJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "auditJobId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "imageDigest" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "argumentsHash" TEXT NOT NULL,
    "exitCode" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "evidenceIds" TEXT[],

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "toolExecutionId" TEXT,
    "tool" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "replayable" BOOLEAN NOT NULL,
    "artifactUri" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "redacted" BOOLEAN NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndpointInventory" (
    "id" TEXT NOT NULL,

    CONSTRAINT "EndpointInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "pathTemplate" TEXT NOT NULL,
    "rawExamples" TEXT[],
    "discoveredBy" TEXT[],
    "statusObserved" INTEGER[],
    "contentType" TEXT,
    "requiresAuth" BOOLEAN,
    "firstSeenAuditId" TEXT NOT NULL,
    "lastSeenAuditId" TEXT NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeMap" (
    "id" TEXT NOT NULL,

    CONSTRAINT "CodeMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteMapping" (
    "id" TEXT NOT NULL,
    "codeMapId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "pathTemplate" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "handlerSymbol" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "middleware" TEXT[],
    "serviceSymbols" TEXT[],
    "source" TEXT NOT NULL,

    CONSTRAINT "RouteMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingIdentity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "firstSeenAuditId" TEXT NOT NULL,
    "lastSeenAuditId" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL,
    "currentSeverity" TEXT NOT NULL,
    "waiverId" TEXT,

    CONSTRAINT "FindingIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ruleId" TEXT,
    "cwe" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "severitySource" TEXT NOT NULL,
    "affectedTarget" TEXT,
    "description" TEXT NOT NULL,
    "reproduction" JSONB NOT NULL,
    "impact" TEXT NOT NULL,
    "rootCause" TEXT,
    "fix" TEXT NOT NULL,
    "fixPatch" TEXT,
    "confidenceBand" TEXT NOT NULL,
    "aiGenerated" BOOLEAN NOT NULL,
    "gateEligible" BOOLEAN NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceLocation" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "enclosingSymbol" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "endLine" INTEGER,
    "commitSha" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,

    CONSTRAINT "SourceLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correlation" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "blackboxFindingId" TEXT NOT NULL,
    "whiteboxFindingId" TEXT,
    "endpointId" TEXT,
    "routeMappingId" TEXT,
    "method" TEXT NOT NULL,
    "confidenceBand" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "rationale" TEXT NOT NULL,
    "alternativesConsidered" JSONB,

    CONSTRAINT "Correlation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassingCheck" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "target" TEXT,
    "evidenceIds" TEXT[],
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateEvaluation" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "gatePolicyId" TEXT NOT NULL,
    "gatePolicyVersion" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "blockingFindingIds" TEXT[],
    "waivedFindingIds" TEXT[],
    "notExecutedCategories" TEXT[],
    "commitSha" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waiver" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "affectedRelease" TEXT,

    CONSTRAINT "Waiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "markedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatePolicy" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingEvidence" (
    "findingId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "FindingEvidence_pkey" PRIMARY KEY ("findingId","evidenceId")
);

-- CreateTable
CREATE TABLE "FindingRelation" (
    "id" TEXT NOT NULL,
    "fromFindingId" TEXT NOT NULL,
    "toFindingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "confidenceBand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "displayPrefix" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "AuditTrailEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "diff" JSONB,
    "metadata" JSONB,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditTrailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FindingIdentity_fingerprint_key" ON "FindingIdentity"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "GatePolicy_projectId_idx" ON "GatePolicy"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GatePolicy_projectId_version_key" ON "GatePolicy"("projectId", "version");

-- CreateIndex
CREATE INDEX "FindingEvidence_evidenceId_idx" ON "FindingEvidence"("evidenceId");

-- CreateIndex
CREATE INDEX "FindingRelation_toFindingId_idx" ON "FindingRelation"("toFindingId");

-- CreateIndex
CREATE UNIQUE INDEX "FindingRelation_fromFindingId_toFindingId_kind_key" ON "FindingRelation"("fromFindingId", "toFindingId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_projectId_idx" ON "ApiToken"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_idx" ON "ProjectMember"("projectId");

-- CreateIndex
CREATE INDEX "AuditTrailEvent_projectId_createdAt_idx" ON "AuditTrailEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditTrailEvent_action_createdAt_idx" ON "AuditTrailEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopePolicy" ADD CONSTRAINT "ScopePolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_buildProvenanceId_fkey" FOREIGN KEY ("buildProvenanceId") REFERENCES "BuildProvenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditJob" ADD CONSTRAINT "AuditJob_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_auditJobId_fkey" FOREIGN KEY ("auditJobId") REFERENCES "AuditJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "EndpointInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteMapping" ADD CONSTRAINT "RouteMapping_codeMapId_fkey" FOREIGN KEY ("codeMapId") REFERENCES "CodeMap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingIdentity" ADD CONSTRAINT "FindingIdentity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "FindingIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLocation" ADD CONSTRAINT "SourceLocation_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correlation" ADD CONSTRAINT "Correlation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassingCheck" ADD CONSTRAINT "PassingCheck_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvaluation" ADD CONSTRAINT "GateEvaluation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatePolicy" ADD CONSTRAINT "GatePolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

