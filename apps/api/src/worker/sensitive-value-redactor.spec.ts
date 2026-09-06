import { SensitiveValueRedactor } from './sensitive-value-redactor';

describe('SensitiveValueRedactor', () => {
  it('removes every registered value before evidence or errors are persisted', () => {
    const redactor = new SensitiveValueRedactor();
    redactor.register('Bearer secret-123');
    const result = redactor.redact('request=Bearer secret-123 response=Bearer secret-123');
    expect(result).toEqual({
      value: 'request=[redacted:secret] response=[redacted:secret]',
      changed: true,
    });
  });

  it('does not claim redaction when no value was present', () => {
    const redactor = new SensitiveValueRedactor();
    redactor.register('secret');
    expect(redactor.redact('clean')).toEqual({ value: 'clean', changed: false });
  });

  it('redacts baseline tokens, structured secrets and query credentials', () => {
    const redactor = new SensitiveValueRedactor('audit-key');
    const raw = 'Bearer abc.def.ghi github_pat_abcdefghijklmnopqrstuvwxyz {"password":"hunter2"} https://x/?api_key=hello';
    const result = redactor.redact(raw);
    expect(result.value).not.toContain('abc.def.ghi');
    expect(result.value).not.toContain('github_pat_');
    expect(result.value).not.toContain('hunter2');
    expect(result.value).not.toContain('api_key=hello');
  });

  it('uses stable audit-scoped PII pseudonyms', () => {
    const raw = 'a.user@example.com +1 (212) 555-0100';
    const first = new SensitiveValueRedactor('audit-a').redact(raw).value;
    expect(first).toBe(new SensitiveValueRedactor('audit-a').redact(raw).value);
    expect(first).not.toBe(new SensitiveValueRedactor('audit-b').redact(raw).value);
    expect(first).not.toContain('example.com');
  });

  it('covers connection, card, government-id, IP, and ordinary header syntax', () => {
    const raw = [
      'postgresql://admin:password@db.internal:5432/kase',
      'card=4242 4242 4242 4242 ssn=123-45-6789 host=192.168.1.10',
      'Cookie: session=very-secret',
    ].join('\n');
    const result = new SensitiveValueRedactor('audit-a').redact(raw).value;
    for (const forbidden of ['admin:password', '4242 4242', '123-45-6789', '192.168.1.10', 'very-secret']) {
      expect(result).not.toContain(forbidden);
    }
    expect(result).toContain('[redacted:payment_card]');
    expect(result).toContain('[pii:ip:');
  });

  it('applies customer patterns in addition to the mandatory baseline', () => {
    const redactor = new SensitiveValueRedactor('audit-a');
    redactor.registerPattern(/CASE-[0-9]{6}/u, 'support-case');
    const result = redactor.redact('CASE-123456 person@example.com').value;
    expect(result).toContain('[redacted:custom:support-case]');
    expect(result).not.toContain('example.com');
  });
});
