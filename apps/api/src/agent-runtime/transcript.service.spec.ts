import { TranscriptService } from './transcript.service';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';

function fixture() {
  const run: any = { id: 'run', auditId: 'audit', audit: { projectId: 'project' }, currentTranscriptId: null };
  const evidence = new Map<string, any>();
  let artifact = Buffer.alloc(0);
  const tx: any = {
    evidence: { upsert: jest.fn(async ({ create }) => { evidence.set(create.id, create); return create; }) },
    agentTurn: { upsert: jest.fn() },
    agentRun: { update: jest.fn(async ({ data }) => Object.assign(run, data)) },
  };
  const db: any = {
    agentRun: { findUniqueOrThrow: jest.fn(async () => run) },
    evidence: { findFirst: jest.fn(async ({ where }) => {
      const row = evidence.get(where.id);
      return row?.auditId === where.auditId && row.expiresAt > where.expiresAt.gt && !row.tombstonedAt ? row : null;
    }) },
    $transaction: jest.fn(async fn => fn(tx)),
  };
  const storage: any = {
    uploadEvidence: jest.fn(async (_project, _audit, bytes) => { artifact = bytes; return { uri: 's3://proof/transcript' }; }),
    verifyEvidence: jest.fn(), downloadEvidence: jest.fn(async () => artifact),
  };
  const retention: any = { expiryForCapture: jest.fn(async () => new Date(Date.now() + 60000)) };
  const service = new TranscriptService(new EvidenceCaptureService(), db, storage, retention);
  const transcript: any = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Authorization: Bearer confidential-token-1234567890' }] }] };
  return { service, run, evidence, storage, tx, db, transcript };
}

describe('M4 durable transcript evidence', () => {
  it('redacts structured values without truncating JSON tokens', () => {
    const f = fixture();
    const value = { token: 'confidential-token-1234567890', nested: { count: 1 } };
    expect(f.service.redactJson('audit', value)).toEqual({ token: expect.not.stringContaining('confidential-token-1234567890'), nested: { count: 1 } });
  });
  it('uploads redacted content before committing the recovery cursor and reloads it from storage', async () => {
    const f = fixture();
    await f.service.checkpoint('run', 0, f.transcript, 1);
    expect(f.storage.uploadEvidence.mock.calls[0][2].toString()).not.toContain('confidential-token-1234567890');
    expect(f.storage.verifyEvidence.mock.invocationCallOrder[0]).toBeLessThan(f.db.$transaction.mock.invocationCallOrder[0]);
    expect(f.run).toMatchObject({ nextTurnSequence: 1, currentTranscriptId: expect.any(String) });
    expect(await f.service.load('run')).toMatchObject({ messages: [{ role: 'user' }] });
  });
  it('does not advance the cursor when storage verification fails', async () => {
    const f = fixture(); f.storage.verifyEvidence.mockRejectedValue(new Error('storage failed'));
    await expect(f.service.checkpoint('run', 0, f.transcript, 1)).rejects.toThrow('storage failed');
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.run.currentTranscriptId).toBeNull();
  });
  it('rejects foreign, expired and corrupted evidence with valid stored evidence as a positive control', async () => {
    const f = fixture(); await f.service.checkpoint('run', 0, f.transcript, 1);
    await expect(f.service.readEvidence('foreign-audit', f.run.currentTranscriptId)).rejects.toThrow('unavailable');
    expect((await f.service.readEvidence('audit', f.run.currentTranscriptId)).length).toBeGreaterThan(0);
    f.storage.downloadEvidence.mockResolvedValue(Buffer.from('tampered'));
    await expect(f.service.load('run')).rejects.toThrow('integrity');
    f.evidence.get(f.run.currentTranscriptId).expiresAt = new Date(0);
    await expect(f.service.load('run')).rejects.toThrow('unavailable');
  });
});
