import { EvidenceCaptureService, UnsafeEvidenceError } from './evidence-capture.service';
import { ProxyHttpAdapter } from '../adapters/http/proxy-http.adapter';

describe('capture-time evidence processing', () => {
  const capture = new EvidenceCaptureService();
  it('redacts before truncating and records the full redacted hash', () => {
    const result = capture.capture('audit-key', 'secret@example.com SECRET and some trailing content', { registeredSecrets: ['SECRET'], maxBytes: 35 });
    const body = result.bytes.toString('utf8');
    expect(body).not.toContain('secret@example.com'); expect(body).not.toContain('SECRET');
    expect(result.truncated).toBe(true); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/); expect(result.fullRedactedSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects unsafe binary evidence', () => expect(() => capture.capture('key', Buffer.from([0, 1, 2]))).toThrow(UnsafeEvidenceError));
  it('preserves JSON token types while redacting string leaves', () => {
    const result = capture.captureJson('audit-key', JSON.stringify({ elapsed: 15551234567, email: 'person@example.com' }));
    const replay = JSON.parse(result.bytes.toString('utf8'));
    expect(replay.elapsed).toBe(15551234567);
    expect(replay.email).not.toContain('person@example.com');
    expect(result.redacted).toBe(true);
  });
});

describe('proxy-only HTTP adapter', () => {
  it('refuses operation without the egress proxy', async () => {
    const adapter = new ProxyHttpAdapter(async () => ({ status: 200, headers: {}, body: Buffer.from('ok') }));
    await expect(adapter.run({ method: 'GET', url: 'https://target.test', proxyUrl: '', auditKey: 'a' })).rejects.toThrow('proxy');
  });
  it('produces a redacted replayable exchange through the proxy executor', async () => {
    const execute = jest.fn(async () => ({ status: 200, headers: { 'set-cookie': 'session=secret' }, body: Buffer.from('{"email":"person@example.com"}') }));
    const result = await new ProxyHttpAdapter(execute).run({ method: 'GET', url: 'https://target.test/resource', proxyUrl: 'http://proxy:3128', auditKey: 'a', secrets: ['secret'] });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ proxyUrl: 'http://proxy:3128' }));
    expect(result.type).toBe('http_exchange'); expect(result.replayable).toBe(true);
    expect(result.content.toString()).not.toContain('person@example.com'); expect(result.content.toString()).not.toContain('secret');
  });
});
