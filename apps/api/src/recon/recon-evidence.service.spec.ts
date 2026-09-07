import { ReconEvidenceService } from './recon-evidence.service';

describe('ReconEvidenceService retry idempotency', () => {
  it('reuses and independently verifies committed job evidence before a retry can duplicate it', async () => {
    const prisma: any = { evidence: { findUnique: jest.fn().mockResolvedValue({
      sha256: 'a'.repeat(64), sizeBytes: 42n, artifactUri: 's3://kase-evidence/existing', tombstonedAt: null,
    }) } };
    const storage: any = { verifyEvidence: jest.fn().mockResolvedValue(undefined), uploadEvidence: jest.fn() };
    const capture: any = { capture: jest.fn() };
    const retention: any = { expiryForCapture: jest.fn() };
    const result = await new ReconEvidenceService(prisma, storage, capture, retention).persist({
      auditId: 'audit_1', auditJobId: 'job_1', projectId: 'prj_1', tool: 'katana', toolVersion: '1.6.1',
      type: 'crawl_result', replayable: false, raw: 'changed retry output', requestCount: 1, durationMs: 1,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ evidenceId: expect.stringMatching(/^ev_/u), sha256: 'a'.repeat(64) });
    expect(storage.verifyEvidence).toHaveBeenCalledWith('s3://kase-evidence/existing', 'a'.repeat(64), 42);
    expect(storage.uploadEvidence).not.toHaveBeenCalled();
    expect(capture.capture).not.toHaveBeenCalled();
  });
});
