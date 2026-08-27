import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { mintApiToken } from '@/auth/session-token';

/**
 * Exchanges the browser's Auth.js session for the short-lived RS256 JWT that
 * apps/api accepts (02-stack §5).
 *
 * The exchange happens server-side, in Next, because the private signing key
 * must never reach the browser. The browser calls this, gets a 15-minute
 * token, and sends it to the API as `Authorization: Bearer <jwt>`.
 */
export async function GET() {
  const session = await auth();
  const s = session as ({ kaseUserId?: string; kaseOrgId?: string } | null);

  if (!s?.kaseUserId || !s.kaseOrgId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const token = await mintApiToken(s.kaseUserId, s.kaseOrgId);
  return NextResponse.json({ token });
}
