import { auth } from '@/auth';
import { mintApiToken } from '@/auth/session-token';
import { ApiError, DEFAULT_API_URL, createKaseApi, type KaseApi } from './kase-api';

export interface Workspace {
  api: KaseApi;
  email: string;
}

/**
 * The signed-in member's API client, or `null` when there is no usable
 * session (callers redirect to /signin). The RS256 token is minted here, on
 * the server, and is never sent to the browser.
 */
export async function workspace(): Promise<Workspace | null> {
  const session = await auth();
  const s = session as ({ kaseUserId?: string; kaseOrgId?: string; user?: { email?: string | null } } | null);
  if (!s?.kaseUserId || !s.kaseOrgId) return null;

  const token = await mintApiToken(s.kaseUserId, s.kaseOrgId);
  return {
    api: createKaseApi(process.env.KASE_API_URL ?? DEFAULT_API_URL, token),
    email: s.user?.email ?? 'Kase member',
  };
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; problem: 'unreachable' | 'forbidden' | 'not-found' | 'error'; detail: string };

/** Turns API failures into states a screen can render instead of a crash page. */
export async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const problem =
      error.code === 'UNREACHABLE' ? 'unreachable'
      : error.status === 401 || error.status === 403 ? 'forbidden'
      : error.status === 404 ? 'not-found'
      : 'error';
    return { ok: false, problem, detail: error.message };
  }
}
