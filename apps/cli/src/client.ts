import { randomUUID } from 'node:crypto';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface AuditRecord {
  id: string;
  status: AuditStatus;
  degraded?: boolean;
  degradationReasons?: string[];
  buildProvenance?: { commitSha: string | null; source: string; verified: boolean } | null;
}

export interface Page<T> { data?: T[]; items?: T[]; nextCursor?: string | null }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export class KaseClient {
  readonly baseUrl: string;

  constructor(baseUrl: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { code?: string; detail?: string; title?: string };
      throw new ApiError(response.status, body.code ?? 'HTTP_ERROR', body.detail ?? body.title ?? `HTTP ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  listProjects() { return this.request<Page<Record<string, unknown>> | Record<string, unknown>[]>('/projects'); }
  listTargets(projectId: string) { return this.request<Record<string, unknown>[]>(`/projects/${projectId}/targets`); }
  listRepositories(projectId: string) { return this.request<Record<string, unknown>[]>(`/projects/${projectId}/repositories`); }

  startAudit(projectId: string, body: Record<string, unknown>): Promise<AuditRecord> {
    return this.request(`/projects/${projectId}/audits`, {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
      body: JSON.stringify(body),
    });
  }

  getAudit(auditId: string): Promise<AuditRecord> { return this.request(`/audits/${auditId}`); }
  cancelAudit(auditId: string): Promise<AuditRecord> { return this.request(`/audits/${auditId}/cancel`, { method: 'POST' }); }

  listFindings(auditId: string, filters: Record<string, string | undefined>): Promise<unknown> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    const suffix = query.size ? `?${query}` : '';
    return this.request(`/audits/${auditId}/findings${suffix}`);
  }

  async waitForAudit(
    auditId: string,
    onEvent: (event: { id?: string; type: string; data: unknown }) => void,
    signal?: AbortSignal,
  ): Promise<AuditRecord> {
    let lastEventId: string | undefined;
    while (!signal?.aborted) {
      const headers = new Headers({ authorization: `Bearer ${this.token}`, accept: 'text/event-stream' });
      if (lastEventId) headers.set('last-event-id', lastEventId);
      const response = await this.fetcher(`${this.baseUrl}/audits/${auditId}/events`, { headers, signal });
      if (!response.ok || !response.body) throw new ApiError(response.status, 'EVENT_STREAM_FAILED', 'Audit event stream failed');
      for await (const event of parseSse(response.body)) {
        if (event.id) lastEventId = event.id;
        onEvent(event);
        if (event.type === 'status' || event.type === 'audit.status') {
          const status = (event.data as { status?: AuditStatus })?.status;
          if (status && isTerminal(status)) return this.getAudit(auditId);
        }
      }
      const current = await this.getAudit(auditId);
      if (isTerminal(current.status)) return current;
      await abortableDelay(250, signal);
    }
    throw new DOMException('Audit wait aborted', 'AbortError');
  }
}

export async function resolveNamed(
  records: Record<string, unknown>[],
  value: string,
  idPrefix: string,
  fields: string[],
  label: string,
): Promise<string> {
  if (value.startsWith(`${idPrefix}_`)) return value;
  const matches = records.filter((record) => fields.some((field) => record[field] === value));
  if (matches.length !== 1 || typeof matches[0].id !== 'string') {
    throw new Error(matches.length === 0 ? `No ${label} matches "${value}"` : `${label} "${value}" is ambiguous`);
  }
  return matches[0].id;
}

function pageItems(value: Page<Record<string, unknown>> | Record<string, unknown>[]): Record<string, unknown>[] {
  if (Array.isArray(value)) return value;
  return value.data ?? value.items ?? [];
}

export async function resolveProject(client: KaseClient, value: string): Promise<string> {
  return resolveNamed(pageItems(await client.listProjects()), value, 'prj', ['slug', 'name'], 'project');
}

export function isTerminal(status: AuditStatus): boolean {
  return ['completed', 'partial', 'failed', 'cancelled'].includes(status);
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ id?: string; type: string; data: unknown }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEventBlock(block);
        if (parsed) yield parsed;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventBlock(block: string): { id?: string; type: string; data: unknown } | null {
  let id: string | undefined;
  let type = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') type = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  let decoded: unknown = raw;
  try { decoded = JSON.parse(raw); } catch { /* text SSE data is valid */ }
  return { ...(id ? { id } : {}), type, data: decoded };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
