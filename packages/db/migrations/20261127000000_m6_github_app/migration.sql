-- M6 G7: GitHub App installations, per-project PR audit settings, and the
-- check run / PR comment each PR audit publishes.

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "installedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubIntegrationConfig" (
    "projectId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'security',
    "targetId" TEXT,
    "partialIsFailure" BOOLEAN NOT NULL DEFAULT false,
    "auditForks" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubIntegrationConfig_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "GithubPrCheck" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "headSha" TEXT NOT NULL,
    "checkRunId" TEXT,
    "commentId" TEXT,
    "state" TEXT NOT NULL,
    "conclusion" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GithubPrCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubInstallation_installationId_key" ON "GithubInstallation"("installationId");
CREATE INDEX "GithubInstallation_projectId_idx" ON "GithubInstallation"("projectId");
CREATE UNIQUE INDEX "GithubPrCheck_auditId_key" ON "GithubPrCheck"("auditId");
CREATE INDEX "GithubPrCheck_state_idx" ON "GithubPrCheck"("state");
CREATE INDEX "GithubPrCheck_projectId_owner_repo_prNumber_idx" ON "GithubPrCheck"("projectId", "owner", "repo", "prNumber");

-- AddForeignKey
ALTER TABLE "GithubInstallation" ADD CONSTRAINT "GithubInstallation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GithubIntegrationConfig" ADD CONSTRAINT "GithubIntegrationConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GithubPrCheck" ADD CONSTRAINT "GithubPrCheck_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
