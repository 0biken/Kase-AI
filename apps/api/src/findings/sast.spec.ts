import { createHash } from 'crypto';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SemgrepAdapter } from '../adapters/sast/semgrep.adapter';
import { normalizeSastFinding } from './sast-normalizer';
import { FindingPersistenceService } from './finding-persistence.service';
import { SastWorkerService } from '../worker/sast-worker.service';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';

const source = `
class OrdersService {
  async getOrder(id: string) {
    return await this.orders.findOne({ where: { id } });
  }
}`;

describe('offline Semgrep adapter and Kase normalization', () => {
  let root: string;
  beforeEach(async () => { root = join(tmpdir(), `kase-sast-${Date.now()}-${Math.random()}`); await mkdir(root, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('verifies local pack digest and invokes Semgrep without network/registry configuration', async () => {
    const pack = join(root, 'pack.yml'); await writeFile(pack, 'rules: []');
    const sha = createHash('sha256').update('rules: []').digest('hex');
    const execute = jest.fn(async (...args: any[]) => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ results: [] }) }));
    await new SemgrepAdapter(execute).run({ checkoutPath: root, rulePackPath: pack, rulePackSha256: sha });
    const [args, options] = execute.mock.calls[0];
    expect(args).toContain(pack); expect(args.join(' ')).not.toMatch(/https?:|p\//);
    expect(options.env.SEMGREP_SEND_METRICS).toBe('off'); expect(options.env.SEMGREP_ENABLE_VERSION_CHECK).toBe('0');
    await expect(new SemgrepAdapter(execute).run({ checkoutPath: root, rulePackPath: pack, rulePackSha256: '0'.repeat(64) })).rejects.toThrow('digest');
  });

  it('rejects engine namespaces before normalization', async () => {
    const pack = join(root, 'pack.yml'); await writeFile(pack, 'rules: []');
    const sha = createHash('sha256').update('rules: []').digest('hex');
    const execute = async () => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ results: [{ check_id: 'semgrep.foo', path: 'a.ts', start: { line: 1, col: 1 }, end: { line: 1, col: 2 }, extra: { message: 'x' } }] }) });
    await expect(new SemgrepAdapter(execute).run({ checkoutPath: root, rulePackPath: pack, rulePackSha256: sha })).rejects.toThrow('namespace');
  });

  it('derives the enclosing class method and assigns authoritative high severity', () => {
    const finding = normalizeSastFinding({ ruleId: 'kase.idor.missing-ownership-predicate', file: 'src/orders.ts',
      startLine: 4, endLine: 4, message: 'Missing ownership predicate', advisorySeverity: 'LOW',
      metadata: { cwe: 'CWE-639', category: 'authorization', confidence: 'HIGH' } },
      { sourceText: source, commitSha: 'a'.repeat(40), target: 'https://api.test/orders/123' });
    expect(finding.sourceLocation.enclosingSymbol).toBe('OrdersService.getOrder');
    expect(finding.severity).toBe('high'); expect(finding.severitySource).toContain('kase-policy');
    expect(finding.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('finding identity persistence', () => {
  it('upserts project-scoped identity and one audit occurrence with primary evidence', async () => {
    const db = { findingIdentity: { upsert: jest.fn(async () => ({ id: 'identity' })), update: jest.fn(async () => ({})) },
      finding: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({ id: 'finding' })) },
      sourceLocation: { upsert: jest.fn(async () => ({})) }, findingEvidence: { upsert: jest.fn(async () => ({})) } };
    const normalized = normalizeSastFinding({ ruleId: 'kase.idor.missing-ownership-predicate', file: 'src/orders.ts', startLine: 4, endLine: 4,
      message: 'Missing ownership predicate', metadata: {} }, { sourceText: source, commitSha: 'a'.repeat(40), target: 'api' });
    await new FindingPersistenceService(db).persist('project', 'audit', 'evidence', normalized);
    expect(db.findingIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId_fingerprint: { projectId: 'project', fingerprint: normalized.fingerprint } } }));
    expect(db.finding.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { auditId_identityId: { auditId: 'audit', identityId: 'identity' } } }));
    expect(db.findingEvidence.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { findingId: expect.any(String), evidenceId: 'evidence', role: 'primary' } }));
    expect(db.findingIdentity.update).toHaveBeenCalledWith(expect.objectContaining({ data: { occurrences: { increment: 1 } } }));
  });

  it('does not increment identity occurrences when a retry replays the same audit occurrence', async () => {
    const db = { findingIdentity: { upsert: jest.fn(async () => ({ id: 'identity' })), update: jest.fn(async () => ({})) },
      finding: { findUnique: jest.fn(async () => ({ id: 'finding' })), upsert: jest.fn(async () => ({ id: 'finding' })) },
      sourceLocation: { upsert: jest.fn(async () => ({})) }, findingEvidence: { upsert: jest.fn(async () => ({})) } };
    const normalized = normalizeSastFinding({ ruleId: 'kase.idor.missing-ownership-predicate', file: 'src/orders.ts', startLine: 4, endLine: 4,
      message: 'Missing ownership predicate', metadata: {} }, { sourceText: source, commitSha: 'a'.repeat(40), target: 'api' });
    await new FindingPersistenceService(db).persist('project', 'audit', 'evidence', normalized);
    expect(db.findingIdentity.update).not.toHaveBeenCalled();
  });
});

describe('persisted Semgrep graph stages', () => {
  it('stores raw evidence before the separate normalization stage creates findings', async () => {
    const root = join(tmpdir(), `kase-sast-stages-${Date.now()}-${Math.random()}`);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/orders.ts'), source);
    const raw = JSON.stringify({ results: [{
      check_id: 'kase.idor.missing-ownership-predicate', path: 'src/orders.ts',
      start: { line: 4, col: 1 }, end: { line: 4, col: 20 },
      extra: { message: 'Missing ownership predicate', severity: 'LOW', metadata: { cwe: 'CWE-639' } },
    }] });
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const db = {
      toolExecution: { upsert: jest.fn() },
      evidence: {
        upsert: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'evidence', artifactUri: 's3://bucket/key', sha256, sizeBytes: Buffer.byteLength(raw) }),
      },
    };
    const storage = {
      uploadEvidence: jest.fn().mockResolvedValue({ uri: 's3://bucket/key', sha256 }),
      verifyEvidence: jest.fn(), downloadEvidence: jest.fn().mockResolvedValue(Buffer.from(raw)),
    };
    const findings = { persist: jest.fn().mockResolvedValue({ identityId: 'identity', findingId: 'finding' }) };
    const adapter = { run: jest.fn().mockResolvedValue({ raw, findings: [{}] }) };
    const service = new SastWorkerService(db as never, storage as never, findings as never, adapter as never, new EvidenceCaptureService());
    const base = {
      projectId: 'project', auditId: 'audit', auditJobId: 'semgrep-job', checkoutPath: root,
      rulePackPath: 'pack.yml', rulePackSha256: 'a'.repeat(64), commitSha: 'b'.repeat(40),
      affectedTarget: 'repository', expiresAt: new Date('2026-12-01T00:00:00Z'),
    };
    await service.executeSemgrep(base);
    expect(findings.persist).not.toHaveBeenCalled();
    await service.normalize({
      projectId: base.projectId, auditId: base.auditId, auditJobId: 'normalize-job',
      checkoutPath: root, commitSha: base.commitSha, affectedTarget: base.affectedTarget,
    });
    expect(findings.persist).toHaveBeenCalledTimes(1);
    await rm(root, { recursive: true, force: true });
  });
});
