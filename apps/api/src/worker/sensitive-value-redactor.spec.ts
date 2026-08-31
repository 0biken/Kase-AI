import { SensitiveValueRedactor } from './sensitive-value-redactor';

describe('SensitiveValueRedactor', () => {
  it('removes every registered value before evidence or errors are persisted', () => {
    const redactor = new SensitiveValueRedactor();
    redactor.register('Bearer secret-123');
    const result = redactor.redact('request=Bearer secret-123 response=Bearer secret-123');
    expect(result).toEqual({
      value: 'request=[redacted] response=[redacted]',
      changed: true,
    });
  });

  it('does not claim redaction when no value was present', () => {
    const redactor = new SensitiveValueRedactor();
    redactor.register('secret');
    expect(redactor.redact('clean')).toEqual({ value: 'clean', changed: false });
  });
});
