import { classifyEvidence, evidenceIntegrityOk } from './evidence-classification';

describe('classifyEvidence', () => {
  it('maps a stored HTTP exchange to the http_replay class', () => {
    expect(classifyEvidence('http_exchange', true)).toBe('http_replay');
  });

  it('maps scanner artifacts to the scanner class', () => {
    expect(classifyEvidence('sast_json', true)).toBe('scanner');
    expect(classifyEvidence('gitleaks', true)).toBe('scanner');
  });

  it('demotes a replayable-typed artifact captured as non-replayable to prose', () => {
    expect(classifyEvidence('http_exchange', false)).toBe('prose');
  });

  it('treats an unknown type as non-replayable prose (never grants block power)', () => {
    expect(classifyEvidence('mystery_blob', true)).toBe('prose');
  });

  it('keeps non-replayable classes as themselves', () => {
    expect(classifyEvidence('screenshot', false)).toBe('screenshot');
    expect(classifyEvidence('trace', false)).toBe('trace');
  });
});

describe('evidenceIntegrityOk', () => {
  it('is sound only when not tombstoned and not deleted', () => {
    expect(evidenceIntegrityOk({ tombstonedAt: null, objectDeletedAt: null })).toBe(true);
    expect(evidenceIntegrityOk({ tombstonedAt: new Date(), objectDeletedAt: null })).toBe(false);
    expect(evidenceIntegrityOk({ tombstonedAt: null, objectDeletedAt: new Date() })).toBe(false);
  });
});
