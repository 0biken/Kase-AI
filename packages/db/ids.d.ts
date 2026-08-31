export declare const ID_PREFIX: {
  readonly organization: 'org';
  readonly user: 'usr';
  readonly project: 'prj';
  readonly repository: 'repo';
  readonly target: 'tgt';
  readonly scopePolicy: 'scp';
  readonly gatePolicy: 'gpol';
  readonly audit: 'aud';
  readonly buildProvenance: 'bp';
  readonly auditJob: 'ajob';
  readonly toolExecution: 'texe';
  readonly evidence: 'ev';
  readonly endpointInventory: 'einv';
  readonly endpoint: 'ep';
  readonly codeMap: 'cmap';
  readonly routeMapping: 'rmap';
  readonly findingIdentity: 'fid';
  readonly finding: 'fnd';
  readonly sourceLocation: 'src';
  readonly correlation: 'cor';
  readonly passingCheck: 'chk';
  readonly gateEvaluation: 'gate';
  readonly waiver: 'wvr';
  readonly suppression: 'sup';
  readonly findingRelation: 'frel';
  readonly apiToken: 'tok';
  readonly projectMember: 'pmem';
  readonly auditTrailEvent: 'evt';
  readonly invite: 'inv';
  readonly secret: 'sec';
  readonly secretVersion: 'sver';
};

export type IdKind = keyof typeof ID_PREFIX;

/** Generates a prefixed ULID, e.g. newId('project') -> 'prj_01H...'. */
export declare function newId(kind: IdKind): string;

/** True when `id` is a well-formed ID of `kind`. */
export declare function isId(kind: IdKind, id: unknown): id is string;

/** Narrows an untrusted string to an ID of `kind`, or throws. */
export declare function assertId(kind: IdKind, id: unknown): string;
