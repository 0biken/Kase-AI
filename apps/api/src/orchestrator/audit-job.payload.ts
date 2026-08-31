/** The complete Redis payload. Secrets, target URLs, and credentials are absent by design. */
export interface ReconAuditJobPayload {
  auditId: string;
  auditJobId: string;
  projectId: string;
}

export const ALLOWED_RECON_PAYLOAD_KEYS = ['auditId', 'auditJobId', 'projectId'] as const;
