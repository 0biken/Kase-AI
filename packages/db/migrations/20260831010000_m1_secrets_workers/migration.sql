-- Versioned envelope-encrypted secrets and the minimum worker/evidence links
-- needed for the M1 vertical slice.

ALTER TABLE "Audit" ADD COLUMN "targetId" TEXT;
ALTER TABLE "Audit" ADD COLUMN "idempotencyKey" TEXT;

CREATE TABLE "Secret" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    CONSTRAINT "Secret_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecretVersion" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "wrappedDataKey" BYTEA NOT NULL,
    "wrappedDataKeyIv" BYTEA NOT NULL,
    "wrappedDataKeyTag" BYTEA NOT NULL,
    "keyProvider" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecretVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Secret_projectId_name_key" ON "Secret"("projectId", "name");
CREATE UNIQUE INDEX "Secret_id_projectId_key" ON "Secret"("id", "projectId");
CREATE INDEX "Secret_projectId_revokedAt_idx" ON "Secret"("projectId", "revokedAt");
CREATE UNIQUE INDEX "SecretVersion_secretId_version_key" ON "SecretVersion"("secretId", "version");
CREATE INDEX "SecretVersion_secretId_createdAt_idx" ON "SecretVersion"("secretId", "createdAt");
CREATE INDEX "Repository_projectId_idx" ON "Repository"("projectId");
CREATE INDEX "Repository_credentialId_projectId_idx" ON "Repository"("credentialId", "projectId");
CREATE INDEX "Target_projectId_idx" ON "Target"("projectId");
CREATE INDEX "Target_authCredentialId_projectId_idx" ON "Target"("authCredentialId", "projectId");
CREATE INDEX "Audit_projectId_startedAt_idx" ON "Audit"("projectId", "startedAt");
CREATE INDEX "Audit_targetId_idx" ON "Audit"("targetId");
CREATE UNIQUE INDEX "Audit_projectId_idempotencyKey_key" ON "Audit"("projectId", "idempotencyKey");
CREATE INDEX "ToolExecution_auditJobId_idx" ON "ToolExecution"("auditJobId");
CREATE INDEX "Evidence_auditId_idx" ON "Evidence"("auditId");
CREATE INDEX "Evidence_toolExecutionId_idx" ON "Evidence"("toolExecutionId");

ALTER TABLE "Secret"
  ADD CONSTRAINT "Secret_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SecretVersion"
  ADD CONSTRAINT "SecretVersion_secretId_fkey"
  FOREIGN KEY ("secretId") REFERENCES "Secret"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Repository"
  ADD CONSTRAINT "Repository_credentialId_projectId_fkey"
  FOREIGN KEY ("credentialId", "projectId") REFERENCES "Secret"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Target"
  ADD CONSTRAINT "Target_authCredentialId_projectId_fkey"
  FOREIGN KEY ("authCredentialId", "projectId") REFERENCES "Secret"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Audit"
  ADD CONSTRAINT "Audit_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_toolExecutionId_fkey"
  FOREIGN KEY ("toolExecutionId") REFERENCES "ToolExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
