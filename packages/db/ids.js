// Prefixed ULIDs, per 14-api §1 ("IDs | Prefixed ULIDs (`aud_01H...`)").
//
// This lives in @kase/db, not in one app, because BOTH apps mint and validate
// them: apps/web creates a User on invite acceptance, and apps/api's AuthGuard
// then validates that id from a JWT claim. A prefix map that drifted between
// the two would fail every sign-in, at runtime, with no compile-time signal.
//
// Plain JS with a hand-written .d.ts, matching index.js — @kase/db has no build
// step so consumers never depend on build order.
const { ulid } = require('ulid');

const ID_PREFIX = {
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
  secret: 'sec',
  secretVersion: 'sver',
};

/** Crockford base32, 26 chars — the ULID canonical form. */
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function newId(kind) {
  return `${ID_PREFIX[kind]}_${ulid()}`;
}

function isId(kind, id) {
  if (typeof id !== 'string') return false;
  const prefix = `${ID_PREFIX[kind]}_`;
  if (!id.startsWith(prefix)) return false;
  return ULID_RE.test(id.slice(prefix.length));
}

function assertId(kind, id) {
  if (!isId(kind, id)) {
    throw new Error(`Expected a ${ID_PREFIX[kind]}_ prefixed ULID, got: ${String(id)}`);
  }
  return id;
}

module.exports = { ID_PREFIX, newId, isId, assertId };
