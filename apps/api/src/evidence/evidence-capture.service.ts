import { createHash } from 'crypto';
import { SensitiveValueRedactor } from '../worker/sensitive-value-redactor';
import { Injectable } from '@nestjs/common';

export class UnsafeEvidenceError extends Error {
  readonly code = 'unsafe_binary_evidence';
}

export interface CapturedEvidence {
  bytes: Buffer;
  sha256: string;
  fullRedactedSha256: string;
  sizeBytes: number;
  fullRedactedSizeBytes: number;
  redacted: boolean;
  truncated: boolean;
}

interface CaptureOptions {
  maxBytes?: number;
  registeredSecrets?: readonly string[];
  customerPatterns?: ReadonlyArray<{ expression: RegExp; label?: string }>;
}

@Injectable()
export class EvidenceCaptureService {
  capture(auditPseudonymKey: string, input: Buffer | string, options: CaptureOptions = {}): CapturedEvidence {
    const raw = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    if (!isSafeText(raw)) throw new UnsafeEvidenceError('Binary evidence is not accepted');
    const redactor = new SensitiveValueRedactor(auditPseudonymKey);
    configureRedactor(redactor, options);
    const result = redactor.redact(raw.toString('utf8'));
    redactor.clear();
    return finishCapture(result.value, result.changed, options.maxBytes);
  }

  /** Redacts string leaves while preserving JSON token types and replayability. */
  captureJson(auditPseudonymKey: string, input: string, options: CaptureOptions = {}): CapturedEvidence {
    const parsed: unknown = JSON.parse(input);
    const redactor = new SensitiveValueRedactor(auditPseudonymKey);
    configureRedactor(redactor, options);
    let changed = false;
    const visit = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const result = redactor.redact(value);
        changed ||= result.changed;
        return result.value;
      }
      if (Array.isArray(value)) return value.map(visit);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
      }
      return value;
    };
    const redacted = JSON.stringify(visit(parsed));
    redactor.clear();
    return finishCapture(redacted, changed, options.maxBytes);
  }
}

function configureRedactor(redactor: SensitiveValueRedactor, options: CaptureOptions): void {
  for (const secret of options.registeredSecrets ?? []) redactor.register(secret);
  for (const pattern of options.customerPatterns ?? []) redactor.registerPattern(pattern.expression, pattern.label);
}

function finishCapture(value: string, redacted: boolean, maxBytes?: number): CapturedEvidence {
    const full = Buffer.from(value, 'utf8');
    const max = maxBytes ?? 2 * 1024 * 1024;
    const bytes = full.length > max ? full.subarray(0, utf8Boundary(full, max)) : full;
    return {
      bytes,
      sha256: digest(bytes),
      fullRedactedSha256: digest(full),
      sizeBytes: bytes.length,
      fullRedactedSizeBytes: full.length,
      redacted,
      truncated: bytes.length !== full.length,
    };
}

function isSafeText(value: Buffer): boolean {
  if (value.includes(0)) return false;
  return !value.toString('utf8').includes('\uFFFD');
}

function utf8Boundary(value: Buffer, max: number): number {
  let end = Math.max(0, Math.min(max, value.length));
  while (end > 0 && end < value.length && (value[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
