export const JOB_STATUSES = [
  'queued',
  'running',
  'waiting',
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
  kind: 'build_provenance' | 'semgrep' | 'normalize_severity' | 'recon' |
    'katana_discover' | 'scope_filter' | 'httpx_verify' | 'inventory_merge' | 'inventory_drift' |
    'code_map' | 'blackbox_agent' | 'whitebox_agent';
  category: string | null;
  dependsOnKinds: readonly JobTemplate['kind'][];
  timeoutMs: number;
  maxRetries: number;
  required: boolean;
}

export const ADAPTER_TIMEOUTS_MS = {
  build_provenance: 5 * 60_000,
  semgrep: 10 * 60_000,
  normalize_severity: 2 * 60_000,
  recon: 10 * 60_000,
  katana_discover: 10 * 60_000,
  scope_filter: 2 * 60_000,
  httpx_verify: 5 * 60_000,
  inventory_merge: 2 * 60_000,
  inventory_drift: 2 * 60_000,
  code_map: 10 * 60_000,
  blackbox_agent: 45 * 60_000,
  whitebox_agent: 35 * 60_000,
} as const;

export function graphTemplate(
  mode: 'smoke' | 'security' | 'full',
  categories?: readonly ('sast' | 'http' | 'blackbox' | 'whitebox')[],
): JobTemplate[] {
  if (mode === 'smoke') {
    return [{
      kind: 'recon', category: 'fixture_health', dependsOnKinds: [],
      timeoutMs: ADAPTER_TIMEOUTS_MS.recon, maxRetries: 2, required: true,
    }];
  }
  const selected = [...(categories ?? (mode === 'full' ? ['sast', 'http'] : ['sast']))];
  if (selected.includes('blackbox') && !selected.includes('http')) selected.push('http');
  if (selected.includes('whitebox') && !selected.includes('sast')) selected.push('sast');
  const jobs: JobTemplate[] = [
    {
      kind: 'build_provenance', category: null, dependsOnKinds: [],
      timeoutMs: ADAPTER_TIMEOUTS_MS.build_provenance, maxRetries: 2, required: true,
    },
  ];
  if (selected.includes('sast')) {
    jobs.push({
      kind: 'semgrep', category: 'sast', dependsOnKinds: ['build_provenance'],
      timeoutMs: ADAPTER_TIMEOUTS_MS.semgrep, maxRetries: 2, required: true,
    });
  }
  if (selected.includes('http')) {
    jobs.push(
      { kind: 'katana_discover', category: 'http', dependsOnKinds: ['build_provenance'], timeoutMs: ADAPTER_TIMEOUTS_MS.katana_discover, maxRetries: 2, required: true },
      { kind: 'scope_filter', category: 'http', dependsOnKinds: ['katana_discover'], timeoutMs: ADAPTER_TIMEOUTS_MS.scope_filter, maxRetries: 0, required: true },
      { kind: 'httpx_verify', category: 'http', dependsOnKinds: ['scope_filter'], timeoutMs: ADAPTER_TIMEOUTS_MS.httpx_verify, maxRetries: 2, required: true },
      { kind: 'inventory_merge', category: 'http', dependsOnKinds: ['httpx_verify'], timeoutMs: ADAPTER_TIMEOUTS_MS.inventory_merge, maxRetries: 2, required: true },
      { kind: 'inventory_drift', category: 'http', dependsOnKinds: ['inventory_merge'], timeoutMs: ADAPTER_TIMEOUTS_MS.inventory_drift, maxRetries: 2, required: true },
    );
  }
  if (selected.includes('whitebox')) {
    jobs.push({
      kind: 'code_map', category: null, dependsOnKinds: ['build_provenance'],
      timeoutMs: ADAPTER_TIMEOUTS_MS.code_map, maxRetries: 2, required: true,
    });
  }

  if (selected.includes('blackbox')) {
    jobs.push({
      kind: 'blackbox_agent', category: 'blackbox', dependsOnKinds: ['inventory_drift'],
      timeoutMs: ADAPTER_TIMEOUTS_MS.blackbox_agent, maxRetries: 1, required: true,
    });
  }
  if (selected.includes('whitebox')) {
    jobs.push({
      kind: 'whitebox_agent', category: 'whitebox', dependsOnKinds: ['semgrep', 'code_map'],
      timeoutMs: ADAPTER_TIMEOUTS_MS.whitebox_agent, maxRetries: 1, required: true,
    });
  }

  if (selected.includes('sast')) {
    jobs.push({
      kind: 'normalize_severity', category: null, dependsOnKinds: ['semgrep'],
      timeoutMs: ADAPTER_TIMEOUTS_MS.normalize_severity, maxRetries: 2, required: true,
    });
  }
  return jobs;
}
