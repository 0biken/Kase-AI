import type { EvidenceClass } from './gate-engine';

/**
 * Maps a stored `Evidence.type` to the gate engine's evidence class. This is
 * the crux of evidence-class gating, so the mapping is explicit rather than
 * inferred, and unrecognised types are treated as non-replayable: an evidence
 * kind the gate does not understand must never grant a finding the power to
 * block (12-policy-gate §3).
 */
const TYPE_TO_CLASS: Readonly<Record<string, EvidenceClass>> = {
  http_exchange: 'http_replay',
  http_replay: 'http_replay',
  sast_json: 'scanner',
  semgrep: 'scanner',
  scanner: 'scanner',
  dependency: 'scanner',
  deps: 'scanner',
  secret: 'scanner',
  gitleaks: 'scanner',
  nuclei: 'scanner',
  regression_test: 'regression_test',
  test_failure: 'regression_test',
  screenshot: 'screenshot',
  trace: 'trace',
  console_log: 'console_log',
  ai_inference: 'ai_inference',
  prose: 'prose',
};

const REPLAYABLE_CLASSES = new Set<EvidenceClass>(['scanner', 'http_replay', 'regression_test']);

/**
 * Derive the engine evidence class from the capture-time `type` and
 * `replayable` flag. The `replayable` boolean is authoritative and strict: if
 * the type maps to a replayable class but the row was captured as
 * non-replayable, the artifact is demoted to `prose` so it cannot block. An
 * unknown type is likewise non-replayable.
 */
export function classifyEvidence(type: string, replayable: boolean): EvidenceClass {
  const mapped = TYPE_TO_CLASS[type];
  if (!mapped) return 'prose';
  if (REPLAYABLE_CLASSES.has(mapped) && !replayable) return 'prose';
  return mapped;
}

/**
 * Capture-time integrity: an artifact whose bytes were tombstoned or deleted is
 * not integrity-sound and cannot block (12-policy-gate §7). Deeper byte-hash
 * verification is a live step performed with storage access, not here.
 */
export function evidenceIntegrityOk(row: { tombstonedAt: Date | null; objectDeletedAt: Date | null }): boolean {
  return row.tombstonedAt === null && row.objectDeletedAt === null;
}
