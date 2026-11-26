import type { ReactNode } from 'react';
import Link from 'next/link';
import type { AuditRow } from '@/lib/workspace-types';
import { Tag, formatUtc, shortSha } from './primitives';

/** The summary strip and Findings / Gate tabs shared by an audit's screens. */
export function AuditFrame({ audit, tab, basePath, children }: { audit: AuditRow; tab: 'findings' | 'gate'; basePath: string; children: ReactNode }) {
  const root = `${basePath}/audits/${audit.id}`;
  return (
    <div className="ws-stack">
      <dl className="ws-facts">
        <div><dt>Status</dt><dd><span className="ws-inline"><Tag>{audit.status}</Tag>{audit.degraded ? <Tag tone="medium">degraded</Tag> : null}</span></dd></div>
        <div><dt>Mode</dt><dd>{audit.mode}</dd></div>
        <div><dt>Commit</dt><dd className="ws-mono">{shortSha(audit.requestedCommitSha)}</dd></div>
        <div><dt>Started</dt><dd>{formatUtc(audit.startedAt)}</dd></div>
        <div><dt>Finished</dt><dd>{formatUtc(audit.completedAt)}</dd></div>
      </dl>

      <nav className="ws-tabs" aria-label="Audit sections">
        <Link href={`${root}/findings`} aria-current={tab === 'findings' ? 'page' : undefined}>Findings</Link>
        <Link href={`${root}/gate`} aria-current={tab === 'gate' ? 'page' : undefined}>Release gate</Link>
      </nav>

      {children}
    </div>
  );
}
