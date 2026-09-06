import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  model: join(root, 'docs', '03-data-model', 'README.md'),
  evidence: join(root, 'docs', '08-evidence', 'README.md'),
  api: join(root, 'docs', '14-api', 'README.md'),
};
const documents = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);

const requestedRetention = process.argv.includes('--retention');
const requestedRedaction = process.argv.includes('--redaction');
const selfTest = process.argv.includes('--self-test');

if (!requestedRetention && !requestedRedaction) {
  throw new Error('Select --retention and/or --redaction');
}

function requireMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`Missing policy contract: ${label}`);
}

function verifyRetention(docs) {
  const combined = `${docs.model}\n${docs.evidence}\n${docs.api}`;
  for (const [label, days] of [
    ['replayableEvidenceDays', 90],
    ['nonReplayableEvidenceDays', 30],
    ['rawToolOutputDays', 30],
    ['agentTranscriptDays', 30],
  ]) {
    requireMatch(docs.model, new RegExp(`${label}: number[^\\n]*${days}`), `${label} platform default ${days}`);
    requireMatch(docs.api, new RegExp(`"${label}": ${days}`), `${label} API example ${days}`);
  }
  requireMatch(docs.evidence, /Replayable evidence \| 90 days/, '90-day replayable evidence');
  requireMatch(docs.evidence, /Non-replayable evidence[^|]*\| 30 days/, '30-day non-replayable evidence');
  requireMatch(docs.evidence, /Raw tool stdout \| 30 days/, '30-day raw tool output');
  requireMatch(docs.evidence, /Agent transcripts \| 30 days/, '30-day transcripts');
  requireMatch(docs.model, /`1 <= value AND value <= 365`/, 'data-model 1-365 policy bounds');
  requireMatch(docs.evidence, /1 through 365 days/, 'evidence-guide 1-365 policy bounds');
  requireMatch(docs.api, /outside 1–365/, 'API 1-365 validation');
  for (const [name, text] of Object.entries(docs)) {
    requireMatch(text, /project\s+override →\s*organization default → platform default/, `${name} effective precedence`);
  }
  requireMatch(docs.model, /shorter effective policy updates existing live rows\s+to the earlier date/, 'data-model monotonic shortening');
  requireMatch(docs.evidence, /Shortening a policy reschedules existing live\s+artifacts to the earlier deadline/, 'evidence-guide monotonic shortening');
  requireMatch(docs.api, /Shortening triggers\s+rescheduling to earlier deadlines/, 'API monotonic shortening');
  requireMatch(combined, /Extending a policy affects new captures only/, 'non-retroactive extension');
  requireMatch(combined, /never (?:extends an existing deletion commitment and )?never resurrects|must not\s+extend an existing deletion commitment or resurrect/, 'no extension or resurrection');
  requireMatch(docs.model, /PostgreSQL `CHECK` constraint of\s+`1 <= value AND value <= 365`/, 'PostgreSQL check constraint');
  requireMatch(docs.model, /\(expiresAt\) WHERE tombstonedAt IS NULL/, 'partial expiry index');
  requireMatch(combined, /bounded batches/, 'bounded retention batches');
  requireMatch(combined, /short (?:database )?transactions/, 'short retention transactions');
  requireMatch(docs.model, /hard-deletes object bytes/, 'data-model hard object deletion');
  requireMatch(docs.evidence, /hard-deletes the object bytes/, 'evidence-guide hard object deletion');
  requireMatch(combined, /already-(?:absent|missing) object (?:counts|as) success/, 'idempotent missing-object deletion');
  requireMatch(docs.model, /Sanitized evidence tombstones and audit-trail events \| Indefinite/, 'data-model indefinite safe records');
  requireMatch(docs.evidence, /Sanitized evidence metadata tombstones \| Indefinite/, 'evidence-guide indefinite safe tombstones');
  requireMatch(docs.evidence, /Audit-trail events \| Indefinite/, 'indefinite audit trail');
  requireMatch(combined, /v1 (?:has no|does not provide) legal[- ]holds?/, 'no v1 legal hold');
  requireMatch(docs.api, /RFC 9457 response after tombstoning/, 'RFC 9457 tombstone response');
  requireMatch(docs.api, /"status": 410/, '410 Gone status');
  requireMatch(docs.api, /"code": "EVIDENCE_EXPIRED"/, 'stable expired-evidence code');
  requireMatch(docs.api, /before\/after diffs/, 'policy audit diffs');
}

function verifyRedaction(docs) {
  const combined = `${docs.model}\n${docs.evidence}\n${docs.api}`;
  requireMatch(docs.evidence, /mandatory and non-disableable/, 'mandatory redaction');
  requireMatch(docs.evidence, /Customer-defined patterns are additive/, 'additive customer patterns');
  for (const label of ['JWTs', 'Private keys', 'Connection strings', 'Provider tokens', 'Payment cards', 'Government IDs', 'Ordinary PII']) {
    requireMatch(docs.evidence, new RegExp(`\\| ${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')} \\|`), `${label} detection`);
  }
  requireMatch(docs.evidence, /Sensitive request and response headers and all cookie values/, 'header and cookie filtering');
  requireMatch(docs.evidence, /email addresses, phone numbers, and IP addresses/, 'ordinary PII classes');
  requireMatch(docs.evidence, /stable \*\*per-audit pseudonym\*\*/, 'per-audit pseudonymization');
  requireMatch(docs.evidence, /neither the source PII nor the HMAC key is stored/, 'pseudonymization secrecy');
  requireMatch(docs.evidence, /never the raw match, surrounding secret-bearing excerpt, or reversible\s+encoding/, 'secret-scanner raw match exclusion');
  requireMatch(docs.evidence, /before truncation, hashing, or upload/, 'redaction processing order');
  requireMatch(docs.model, /sha256:[^\n]*(?:stored|possibly truncated)[^\n]*redacted bytes/i, 'data-model stored-byte SHA-256');
  requireMatch(docs.evidence, /sha256:[^\n]*stored, redacted bytes/i, 'evidence-guide stored-byte SHA-256');
  requireMatch(docs.model, /fullRedactedSha256/, 'data-model full redacted-content hash');
  requireMatch(docs.evidence, /fullRedactedSha256/, 'evidence-guide full redacted-content hash');
  requireMatch(docs.evidence, /unsafe screenshot, trace, archive, or\s+other opaque binary is dropped rather than uploaded/, 'unsafe binary rejection');
  requireMatch(docs.evidence, /evidence\.capture_rejected/, 'binary rejection event');
  requireMatch(docs.evidence, /Audit\.degraded = true/, 'rejection degrades audit');
}

function expectFailure(check, mutated, label) {
  try {
    check(mutated);
  } catch {
    return;
  }
  throw new Error(`Self-test failed: verifier accepted ${label}`);
}

if (requestedRetention) {
  verifyRetention(documents);
  if (selfTest) {
    expectFailure(
      verifyRetention,
      { ...documents, evidence: documents.evidence.replace('Replayable evidence | 90 days', 'Replayable evidence | 365 days') },
      'a contradictory replayable retention default',
    );
    expectFailure(
      verifyRetention,
      { ...documents, api: documents.api.replace('"status": 410', '"status": 404') },
      'a non-410 tombstone response',
    );
  }
  console.log('EVIDENCE_RETENTION_VERIFIED');
}

if (requestedRedaction) {
  verifyRedaction(documents);
  if (selfTest) {
    expectFailure(
      verifyRedaction,
      { ...documents, evidence: documents.evidence.replace('mandatory and non-disableable', 'optional') },
      'optional redaction',
    );
    expectFailure(
      verifyRedaction,
      { ...documents, evidence: documents.evidence.replace('evidence.capture_rejected', 'evidence.capture_skipped') },
      'a missing rejected-binary audit event',
    );
  }
  console.log('EVIDENCE_REDACTION_VERIFIED');
}
