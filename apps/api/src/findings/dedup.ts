import { z } from 'zod';

/**
 * Pass 2 semantic dedup (09-findings §5), as a pure decision.
 *
 *   Level 1  same fingerprint                              → MATCH
 *   Level 2  no source location: same category, target,
 *            cwe and a compatible severity band            → MATCH
 *            … but cwe absent on one side                  → POSSIBLE_MATCH
 *   Level 3  AI similarity band on the ambiguous remainder → POSSIBLE_MATCH at most
 *
 * AI similarity never produces MATCH, and its band is ordinal: it is never a
 * number compared against a threshold. A POSSIBLE_MATCH is a proposal for a
 * human; nothing here resolves one.
 */

export type DedupOutcome =
  | { outcome: 'MATCH'; level: 1 | 2; identityId: string }
  | { outcome: 'POSSIBLE_MATCH'; level: 2 | 3; candidates: Array<{ identityId: string; confidenceBand: 'high' | 'medium' }> }
  | { outcome: 'NEW_FINDING' };

export interface DedupSubject {
  identityId: string;
  fingerprint: string;
  category: string;
  cwe: string | null;
  severity: string;
  /** `METHOD /path/{id}` or a file path; null when nothing structural is known. */
  normalizedTarget: string | null;
  hasSourceLocation: boolean;
  title: string;
  description: string;
}

/** Pairs a human already rejected are never proposed again. */
export interface DedupContext { rejectedPairs: ReadonlySet<string> }

const BANDS = ['info', 'low', 'medium', 'high', 'critical'];
export function compatibleSeverity(a: string, b: string): boolean {
  const i = BANDS.indexOf(a.toLowerCase());
  const j = BANDS.indexOf(b.toLowerCase());
  return i >= 0 && j >= 0 && Math.abs(i - j) <= 1;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Normalises a finding's affected target into a structural key: an HTTP target
 * becomes `METHOD /template` with identifier segments collapsed; anything else
 * is used as written. Never derived from model prose.
 */
export function normalizeTarget(target: string | null | undefined): string | null {
  if (!target) return null;
  const trimmed = target.trim();
  const http = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|TRACE)\s+(\S+)$/iu.exec(trimmed);
  const raw = http ? http[2] : trimmed;
  let path = raw;
  try { if (/^https?:\/\//iu.test(raw)) path = new URL(raw).pathname; } catch { return null; }
  if (!path.startsWith('/')) return trimmed.slice(0, 1024);
  const template = path.split('?')[0].split('/').map(segment =>
    /^\{[^}]*\}$|^:[A-Za-z_]\w*$|^\d+$|^[0-9a-f]{8}-[0-9a-f-]{27}$|^[A-Za-z]{2,5}_[A-Za-z0-9]+$|^[0-9a-f]{16,}$/iu.test(segment) ? '{id}' : segment,
  ).join('/').replace(/\/+$/u, '') || '/';
  return `${http ? http[1].toUpperCase() : 'ANY'} ${template}`;
}

export function classifyDedup(subject: DedupSubject, existing: readonly DedupSubject[], context: DedupContext,
  advisory: ReadonlyArray<{ identityId: string; band: 'high' | 'medium' | 'low' }> = []): DedupOutcome {
  const others = existing.filter(other => other.identityId !== subject.identityId);

  // Level 1. Fingerprint equality is identity, so it is always a MATCH.
  const exact = others.find(other => other.fingerprint === subject.fingerprint);
  if (exact) return { outcome: 'MATCH', level: 1, identityId: exact.identityId };

  const open = others.filter(other => !context.rejectedPairs.has(pairKey(subject.identityId, other.identityId)));

  // Level 2 applies only when correlation could not attach a source location.
  if (!subject.hasSourceLocation && subject.normalizedTarget) {
    const structural = open.filter(other => !other.hasSourceLocation && other.category === subject.category
      && other.normalizedTarget === subject.normalizedTarget && compatibleSeverity(other.severity, subject.severity)
      && (!subject.cwe || !other.cwe || subject.cwe === other.cwe));
    const full = structural.filter(other => subject.cwe && other.cwe);
    // Exactly one fully agreeing candidate merges; several are ambiguous and go to a human.
    if (full.length === 1 && structural.length === 1) return { outcome: 'MATCH', level: 2, identityId: full[0].identityId };
    if (structural.length) {
      return { outcome: 'POSSIBLE_MATCH', level: 2, candidates: structural.map(other => ({ identityId: other.identityId, confidenceBand: full.includes(other) ? 'high' as const : 'medium' as const })) };
    }
  }

  // Level 3: AI-proposed candidates, restricted to the same category and to
  // identities that actually exist in the candidate set.
  const known = new Map(open.filter(other => other.category === subject.category).map(other => [other.identityId, other]));
  const proposed = advisory.filter(item => item.band !== 'low' && known.has(item.identityId));
  if (proposed.length) {
    const unique = new Map(proposed.map(item => [item.identityId, item.band as 'high' | 'medium']));
    return { outcome: 'POSSIBLE_MATCH', level: 3, candidates: [...unique].map(([identityId, confidenceBand]) => ({ identityId, confidenceBand })) };
  }
  return { outcome: 'NEW_FINDING' };
}

/** Every advisor response is schema-validated before it can influence anything. */
export const advisorResponseSchema = z.object({
  similar: z.array(z.object({ identityId: z.string().min(1).max(100), band: z.enum(['high', 'medium', 'low']) }).strict()).max(50),
}).strict();

/**
 * Level-3 port. The default advisor proposes nothing, so dedup is fully
 * deterministic unless a project opts into an AI advisor.
 */
export interface DedupAdvisor {
  similar(subject: DedupSubject, candidates: readonly DedupSubject[]): Promise<unknown>;
}
export const DEDUP_ADVISOR = Symbol('DEDUP_ADVISOR');
export const noAdvisor: DedupAdvisor = { similar: async () => ({ similar: [] }) };
