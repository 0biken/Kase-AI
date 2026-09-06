export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'timed_out',
  'cancelled',
] as const;

export type AuditJobStatus = (typeof JOB_STATUSES)[number];

export interface JobGraphNode {
  id: string;
  kind: string;
  dependsOn: readonly string[];
  status: AuditJobStatus;
  required?: boolean;
}

export const TERMINAL_JOB_STATUSES: readonly AuditJobStatus[] = [
  'succeeded',
  'failed',
  'skipped',
  'timed_out',
  'cancelled',
];

export class InvalidJobGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobGraphError';
  }
}

export function validateJobGraph(nodes: readonly JobGraphNode[]): void {
  const byId = new Map<string, JobGraphNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new InvalidJobGraphError(`Duplicate job id: ${node.id}`);
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (dependency === node.id) throw new InvalidJobGraphError(`Job ${node.id} depends on itself`);
      if (!byId.has(dependency)) {
        throw new InvalidJobGraphError(`Job ${node.id} has missing dependency ${dependency}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new InvalidJobGraphError(`Dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}

/**
 * Normalization may run over partial adapter artifacts. All other jobs require
 * successful dependencies; normalization requires at least one successful
 * adapter once every dependency has settled.
 */
export function readyJobs(
  nodes: readonly JobGraphNode[],
  concurrencyAvailable = 4,
): JobGraphNode[] {
  if (concurrencyAvailable <= 0) return [];
  validateJobGraph(nodes);
  const status = new Map(nodes.map((node) => [node.id, node.status]));
  return nodes
    .filter((node) => {
      if (node.status !== 'queued') return false;
      const dependencies = node.dependsOn.map((id) => status.get(id)!);
      if (node.kind === 'normalize_severity') {
        return dependencies.length > 0 &&
          dependencies.every((value) => TERMINAL_JOB_STATUSES.includes(value)) &&
          dependencies.some((value) => value === 'succeeded');
      }
      return dependencies.every((value) => value === 'succeeded');
    })
    .slice(0, concurrencyAvailable);
}

export function blockedJobs(nodes: readonly JobGraphNode[]): JobGraphNode[] {
  validateJobGraph(nodes);
  const status = new Map(nodes.map((node) => [node.id, node.status]));
  return nodes.filter((node) => {
    if (node.status !== 'queued' || node.dependsOn.length === 0) return false;
    const dependencies = node.dependsOn.map((id) => status.get(id)!);
    if (!dependencies.every((value) => TERMINAL_JOB_STATUSES.includes(value))) return false;
    return node.kind === 'normalize_severity'
      ? !dependencies.some((value) => value === 'succeeded')
      : dependencies.some((value) => value !== 'succeeded');
  });
}

export interface JobTemplate {
  kind: 'build_provenance' | 'http' | 'semgrep' | 'normalize_severity' | 'recon';
  category: string | null;
  dependsOnKinds: readonly JobTemplate['kind'][];
  timeoutMs: number;
  maxRetries: number;
  required: boolean;
}

export const ADAPTER_TIMEOUTS_MS = {
  build_provenance: 5 * 60_000,
  http: 60_000,
  semgrep: 10 * 60_000,
  normalize_severity: 2 * 60_000,
  recon: 10 * 60_000,
} as const;

export function graphTemplate(
  mode: 'smoke' | 'security' | 'full',
  categories?: readonly ('sast' | 'http')[],
): JobTemplate[] {
  if (mode === 'smoke') {
    return [{
      kind: 'recon', category: 'fixture_health', dependsOnKinds: [],
      timeoutMs: ADAPTER_TIMEOUTS_MS.recon, maxRetries: 2, required: true,
    }];
  }
  const selected = categories ?? (mode === 'full' ? ['sast', 'http'] : ['sast']);
  const adapterKinds: JobTemplate['kind'][] = selected.map((category) => category === 'sast' ? 'semgrep' : 'http');
  return [
    {
      kind: 'build_provenance', category: null, dependsOnKinds: [],
      timeoutMs: ADAPTER_TIMEOUTS_MS.build_provenance, maxRetries: 2, required: true,
    },
    ...adapterKinds.map((kind): JobTemplate => ({
      kind,
      category: kind === 'semgrep' ? 'sast' : 'http',
      dependsOnKinds: ['build_provenance'],
      timeoutMs: ADAPTER_TIMEOUTS_MS[kind],
      maxRetries: 2,
      required: true,
    })),
    {
      kind: 'normalize_severity', category: null, dependsOnKinds: adapterKinds,
      timeoutMs: ADAPTER_TIMEOUTS_MS.normalize_severity, maxRetries: 2, required: true,
    },
  ];
}
