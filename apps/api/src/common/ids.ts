import { ulid } from 'ulid';

/**
 * Prefixed ULIDs, per 14-api §1 ("IDs | Prefixed ULIDs (`aud_01H...`)").
 *
 * ULID over UUID because the docs say so, but the reason it is the right call:
 * ULIDs sort lexicographically by creation time, which is what makes the
 * cursor pagination in §1 (`?limit=50&cursor=...`) work without a separate
 * sort column. A random UUID cursor would need one.
 *
 * The prefix is not decoration. When a finding cites an ID in a report, or a
 * CI log shows one, the prefix says what it refers to without a lookup — and a
 * mis-scoped query that passes `aud_...` where `prj_...` belongs fails loudly
 * instead of silently returning nothing.
 */
export const ID_PREFIX = {
  organization: 'org',
  user: 'usr',
  project: 'prj',
  repository: 'repo',
  target: 'tgt',
  scopePolicy: 'scp',
  gatePolicy: 'gpol',
  audit: 'aud',
  buildProvenance: 'bp',
  auditJob: 'ajob',
  toolExecution: 'texe',
  evidence: 'ev',
  endpointInventory: 'einv',
  endpoint: 'ep',
  codeMap: 'cmap',
  routeMapping: 'rmap',
  findingIdentity: 'fid',
  finding: 'fnd',
  sourceLocation: 'src',
  correlation: 'cor',
  passingCheck: 'chk',
  gateEvaluation: 'gate',
  waiver: 'wvr',
  suppression: 'sup',
  findingRelation: 'frel',
  apiToken: 'tok',
  projectMember: 'pmem',
  auditTrailEvent: 'evt',
  invite: 'inv',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/** Generates a prefixed ULID, e.g. newId('project') -> 'prj_01H...'. */
export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${ulid()}`;
}

/**
 * True when `id` is a well-formed ID of `kind`.
 *
 * Underscore-separated rather than split-and-compare because a ULID never
 * contains an underscore, so the first one is unambiguously the delimiter.
 */
export function isId(kind: IdKind, id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const prefix = `${ID_PREFIX[kind]}_`;
  if (!id.startsWith(prefix)) return false;
  return ULID_RE.test(id.slice(prefix.length));
}

/** Crockford base32, 26 chars — the ULID canonical form. */
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * Narrows an untrusted string to an ID of `kind`, or throws.
 *
 * Used at trust boundaries (route params) so a malformed ID is rejected before
 * it reaches a query, rather than becoming a silent empty result.
 */
export function assertId(kind: IdKind, id: unknown): string {
  if (!isId(kind, id)) {
    throw new Error(`Expected a ${ID_PREFIX[kind]}_ prefixed ULID, got: ${String(id)}`);
  }
  return id;
}
