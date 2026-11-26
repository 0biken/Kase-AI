import type { AuditRow, FindingFilters, FindingRow, GateEvaluationRow, ProjectRow } from './workspace-types';

/**
 * Read-only client for apps/api, used from Server Components.
 *
 * The dashboard reads through the API rather than the database so every
 * request passes the API's project-scope and role checks. This module holds
 * no session logic (see kase-api-session.ts), which keeps it testable with a
 * plain fetch double.
 */

export const DEFAULT_API_URL = 'http://localhost:3002/api/v1';

/** `UNREACHABLE` is ours: the request never got an HTTP answer. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface KaseApi {
  listProjects(): Promise<ProjectRow[]>;
  listAudits(projectId: string): Promise<AuditRow[]>;
  getAudit(auditId: string): Promise<AuditRow>;
  listFindings(auditId: string, filters?: FindingFilters): Promise<FindingRow[]>;
  /** `null` means the audit has never been evaluated, which is a normal state. */
  getGate(auditId: string): Promise<GateEvaluationRow | null>;
}

export function createKaseApi(baseUrl: string, token: string, fetcher: typeof fetch = fetch): KaseApi {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${root}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        // Workspace data must never be served from a shared cache.
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'UNREACHABLE', 'The Kase API did not respond.');
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string; detail?: string; title?: string };
      throw new ApiError(response.status, body.code ?? 'HTTP_ERROR', body.detail ?? body.title ?? `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  const id = encodeURIComponent;

  return {
    async listProjects() {
      // GET /projects is paginated ({ data, hasMore }); older builds returned a bare array.
      const page = await request<{ data?: ProjectRow[] } | ProjectRow[]>('/projects');
      return Array.isArray(page) ? page : (page.data ?? []);
    },
    listAudits: (projectId) => request(`/projects/${id(projectId)}/audits`),
    getAudit: (auditId) => request(`/audits/${id(auditId)}`),
    listFindings(auditId, filters = {}) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      const suffix = query.size ? `?${query}` : '';
      return request(`/audits/${id(auditId)}/findings${suffix}`);
    },
    async getGate(auditId) {
      try {
        return await request<GateEvaluationRow>(`/audits/${id(auditId)}/gate`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
