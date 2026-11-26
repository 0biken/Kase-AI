import type { ReactNode } from 'react';
import type { Loaded } from '@/lib/kase-api-session';

const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

/** One severity label for every screen, coloured from the --sev-* tokens. */
export function SeverityChip({ severity }: { severity: string }) {
  const tone = KNOWN_SEVERITIES.has(severity) ? severity : 'neutral';
  return <span className={`ws-chip ws-chip-${tone}`}>{severity}</span>;
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'pass' | 'critical' | 'medium' }) {
  return <span className={`ws-chip ws-chip-${tone}`}>{children}</span>;
}

/** Dates are rendered on the server in UTC so they never shift on hydration. */
export function formatUtc(iso: string | null): string {
  if (!iso) return 'Not finished';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : 'No commit';
}

/** An empty, missing or failed state. Says what happened and what to do next. */
export function StateCard({ title, children, tone = 'neutral' }: { title: string; children: ReactNode; tone?: 'neutral' | 'problem' }) {
  return (
    <section className={`card ws-state${tone === 'problem' ? ' ws-state-problem' : ''}`} role={tone === 'problem' ? 'alert' : undefined}>
      <div className="card-body">
        <h2 className="card-heading">{title}</h2>
        <div className="ws-state-body">{children}</div>
      </div>
    </section>
  );
}

const PROBLEM_COPY: Record<Exclude<Loaded<unknown>, { ok: true }>['problem'], { title: string; body: string }> = {
  'unreachable': { title: 'The Kase API is not responding', body: 'The dashboard could not reach the API. Check that it is running and that KASE_API_URL points at it, then reload.' },
  'forbidden': { title: 'You do not have access', body: 'Your account is not a member of the project that owns this data. Ask a project admin to add you.' },
  'not-found': { title: 'Not found', body: 'This record does not exist, or it belongs to a project you cannot see.' },
  'error': { title: 'Something went wrong', body: 'The API returned an error. Reload to try again.' },
};

export function ProblemState({ failure }: { failure: Exclude<Loaded<unknown>, { ok: true }> }) {
  const copy = PROBLEM_COPY[failure.problem];
  return (
    <StateCard title={copy.title} tone="problem">
      <p>{copy.body}</p>
      {failure.problem === 'error' ? <p className="ws-mono">{failure.detail}</p> : null}
    </StateCard>
  );
}

export function SampleBadge() {
  return <span className="ws-sample">Sample data</span>;
}
