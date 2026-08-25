import { Finding, Evidence, HttpExchange } from './types';
import { sha256, shortHash } from './sast';

interface ProbeAccount {
  userId: string;
  token: string;
  ownedInvoiceId: string;
}

/**
 * Black-box IDOR probe.
 *
 * Stands in for the black-box agent (docs/05). The agent would reason its
 * way here from the endpoint inventory; the spike hard-codes the single
 * check so the correlation path is what is under test, not the agent loop.
 *
 * Needs two accounts — one to own the record, one to attempt the read.
 * A single-account audit cannot detect IDOR at all, which is why scoping
 * asks for two.
 */
export async function probeIdor(
  baseUrl: string,
  owner: ProbeAccount,
  attacker: ProbeAccount,
): Promise<{ finding: Finding | null; exchange: HttpExchange }> {
  const url = `${baseUrl}/api/invoices/${owner.ownedInvoiceId}`;
  const requestHeaders = { authorization: `Bearer ${attacker.token}` };

  const res = await fetch(url, { headers: requestHeaders });
  const body = await res.text();

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => (responseHeaders[k] = v));

  const exchange: HttpExchange = {
    request: { method: 'GET', url, headers: requestHeaders },
    response: { status: res.status, headers: responseHeaders, body },
    replayHash: sha256(`GET ${url} ${attacker.token}`),
  };

  // The finding condition: a non-owner received the record.
  const leaked = res.status === 200 && body.includes(owner.ownedInvoiceId);
  if (!leaked) {
    return { finding: null, exchange };
  }

  const evidence: Evidence = {
    id: `EV-${shortHash(exchange.replayHash)}`,
    tool: 'http',
    type: 'http_exchange',
    // Re-executable against the target: gate-eligible under ADR-002.
    evidenceClass: 'replayable',
    sha256: sha256(JSON.stringify(exchange)),
    payload: exchange,
  };

  const finding: Finding = {
    id: `BB-${shortHash(url)}`,
    origin: 'blackbox',
    tool: 'http',
    ruleId: null,
    category: 'authorization',
    cwe: 'CWE-639',
    title: 'IDOR — invoice readable across user boundary',
    severityProposed: 'critical',
    affectedTarget: new URL(url).pathname,   // concrete; templatized during correlation
    sourceLocations: [],                     // black box cannot know this — correlation supplies it
    evidence: [evidence],
    description:
      `${attacker.userId} requested an invoice owned by ${owner.userId} and received ` +
      `HTTP ${res.status} with the record body. Authentication succeeded and ` +
      `authorization was never enforced.`,
  };

  return { finding, exchange };
}

/**
 * Replays a stored exchange to confirm the finding still reproduces.
 * The gate requires this before blocking — a finding that no longer
 * reproduces must not fail a build (ADR-002).
 */
export async function replay(exchange: HttpExchange): Promise<boolean> {
  try {
    const res = await fetch(exchange.request.url, { headers: exchange.request.headers });
    const body = await res.text();
    return res.status === exchange.response.status && body === exchange.response.body;
  } catch {
    return false;
  }
}

/** Resolves build provenance from the target's build-info endpoint (ADR-003). */
export async function resolveProvenance(
  baseUrl: string,
  ciSuppliedSha: string | null,
): Promise<{ commitSha: string | null; source: 'ci_supplied' | 'build_info_endpoint' | 'assumed'; verified: boolean }> {
  if (ciSuppliedSha) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      const data: any = await res.json();
      if (data?.commit && data.commit === ciSuppliedSha) {
        return { commitSha: ciSuppliedSha, source: 'ci_supplied', verified: true };
      }
      if (data?.commit && data.commit !== ciSuppliedSha) {
        // Deployment and checkout disagree — correlation would point at the
        // wrong source. Refuse to verify.
        return { commitSha: null, source: 'assumed', verified: false };
      }
    } catch {
      /* fall through */
    }
    return { commitSha: ciSuppliedSha, source: 'ci_supplied', verified: true };
  }

  try {
    const res = await fetch(`${baseUrl}/healthz`);
    const data: any = await res.json();
    if (data?.commit) {
      return { commitSha: data.commit, source: 'build_info_endpoint', verified: true };
    }
  } catch {
    /* fall through */
  }

  return { commitSha: null, source: 'assumed', verified: false };
}
