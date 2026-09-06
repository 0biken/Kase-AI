import { createHmac } from 'crypto';

/** Capture-time redactor. Registered secrets live only for the lifetime of one job. */
export class SensitiveValueRedactor {
  private readonly values = new Set<string>();
  private readonly patterns: Array<{ expression: RegExp; label: string }> = [];

  constructor(private readonly pseudonymKey = 'ephemeral-redaction-key') {}

  register(value: string): void {
    if (value.length > 0) this.values.add(value);
  }

  registerPattern(expression: RegExp, label = 'customer'): void {
    if (expression.source.length === 0) throw new Error('Redaction pattern cannot be empty');
    const flags = [...new Set(`${expression.flags}gu`.replace('y', ''))].join('');
    this.patterns.push({ expression: new RegExp(expression.source, flags), label: safeLabel(label) });
  }

  redact(value: string): { value: string; changed: boolean } {
    let output = value;
    for (const secret of [...this.values].sort((a, b) => b.length - a.length)) {
      output = output.split(secret).join('[redacted:secret]');
    }
    output = output
      .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s"'<>]+/giu, '[redacted:connection_string]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted:jwt]')
      .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, '[redacted:aws_access_key]')
      .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,255}\b/gu, '[redacted:token]')
      .replace(/\b(?:glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,})\b/gu, '[redacted:token]')
      .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/gu, '[redacted:token]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/giu, 'Bearer [redacted:token]')
      .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu, '[redacted:private_key]')
      .replace(/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*.*$/gimu, '$1: [redacted]')
      .replace(/([?&](?:access_token|api_key|apikey|password|secret|token)=)[^&#\s]*/giu, '$1[redacted]')
      .replace(/("(?:authorization|cookie|set-cookie|password|secret|token|ssn|national_id|government_id)"\s*:\s*")[^"]*(")/giu, '$1[redacted]$2')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/gu, '[redacted:government_id]')
      .replace(/\b(?:\d[ -]?){13,19}\b/gu, (candidate) => isPaymentCard(candidate) ? '[redacted:payment_card]' : candidate)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, (email) => this.pseudonym('email', email.toLowerCase()))
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, (address) => isIpv4(address) ? this.pseudonym('ip', address) : address)
      .replace(/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{0,4}\b/giu, (address) => this.pseudonym('ip', address.toLowerCase()))
      .replace(/\b(?:\+?\d[\d .()-]{7,}\d)\b/gu, (phone) => this.pseudonym('phone', phone.replace(/\D/gu, '')));
    for (const { expression, label } of this.patterns) {
      output = output.replace(expression, `[redacted:custom:${label}]`);
    }
    return { value: output, changed: output !== value };
  }

  clear(): void {
    this.values.clear();
    this.patterns.length = 0;
  }

  private pseudonym(kind: string, value: string): string {
    const digest = createHmac('sha256', this.pseudonymKey).update(`${kind}:${value}`).digest('hex').slice(0, 16);
    return `[pii:${kind}:${digest}]`;
  }
}

function safeLabel(value: string): string {
  const label = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').slice(0, 40);
  return label || 'customer';
}

function isPaymentCard(value: string): boolean {
  const digits = value.replace(/\D/gu, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double && (digit *= 2) > 9) digit -= 9;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function isIpv4(value: string): boolean {
  return value.split('.').every((part) => Number(part) <= 255);
}
