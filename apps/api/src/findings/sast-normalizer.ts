import { createHash } from 'crypto';
import type { SastAdapterFinding } from '../adapters/sast/semgrep.types';
import { resolveEnclosingSymbol } from './enclosing-symbol';
import { assignSeverity } from './severity-policy';

export interface NormalizedSastFinding {
  fingerprint: string; ruleId: string; category: string; cwe: string; title: string;
  severity: string; severitySource: string; affectedTarget: string; description: string;
  confidenceBand: string; gateEligible: boolean; sourceLocation: {
    file: string; enclosingSymbol: string; line: number; endLine: number; commitSha: string; verified: true;
  };
}

export function normalizeSastFinding(input: SastAdapterFinding, context: {
  sourceText: string; commitSha: string; target: string;
}): NormalizedSastFinding {
  if (!input.ruleId.startsWith('kase.')) throw new Error('Only stable Kase rule IDs may be normalized');
  const file = input.file.replace(/^\.\//u, '').replace(/\\/gu, '/');
  const enclosingSymbol = resolveEnclosingSymbol(context.sourceText, file, input.startLine);
  const cwe = String(input.metadata.cwe ?? 'CWE-639');
  const category = String(input.metadata.category ?? 'authorization');
  const severity = assignSeverity(input.ruleId, input.advisorySeverity);
  const fingerprintMaterial = [category, input.ruleId, normalizeTarget(context.target), file, enclosingSymbol, cwe].join('\u001f');
  return { fingerprint: createHash('sha256').update(fingerprintMaterial).digest('hex'), ruleId: input.ruleId,
    category, cwe, title: input.message, ...severity, affectedTarget: context.target, description: input.message,
    confidenceBand: String(input.metadata.confidence ?? 'high').toLowerCase(), gateEligible: true,
    sourceLocation: { file, enclosingSymbol, line: input.startLine, endLine: input.endLine, commitSha: context.commitSha, verified: true } };
}

function normalizeTarget(value: string): string {
  try { const url = new URL(value); url.hash = ''; url.search = ''; return url.toString().replace(/\/$/u, '').toLowerCase(); }
  catch { return value.trim().replace(/\\/gu, '/').toLowerCase(); }
}
