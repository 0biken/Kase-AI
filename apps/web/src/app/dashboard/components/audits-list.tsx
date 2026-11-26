import Link from 'next/link';
import type { AuditRow } from '@/lib/workspace-types';
import { StateCard, Tag, formatUtc, shortSha } from './primitives';

const STATUS_TONE: Record<string, 'neutral' | 'pass' | 'critical' | 'medium'> = {
  completed: 'pass',
  partial: 'medium',
  failed: 'critical',
  cancelled: 'neutral',
  running: 'neutral',
  queued: 'neutral',
};

export function AuditsList({ audits, basePath }: { audits: AuditRow[]; basePath: string }) {
  if (audits.length === 0) {
    return (
      <StateCard title="No audits yet">
        <p>Audits appear here once one has been started for a project you belong to.</p>
        <p>Start one from the CLI:</p>
        <pre className="ws-command"><code>kase audit start --project &lt;project&gt; --target &lt;target&gt;</code></pre>
      </StateCard>
    );
  }

  return (
    <section className="card">
      <div className="ws-table-wrap">
        <table className="ws-table">
          <thead>
            <tr>
              <th scope="col">Audit</th>
              <th scope="col">Status</th>
              <th scope="col">Mode</th>
              <th scope="col">Commit</th>
              <th scope="col">Started</th>
              <th scope="col"><span className="ws-visually-hidden">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {audits.map((audit) => (
              <tr key={audit.id}>
                <td>
                  <Link className="ws-row-link ws-mono" href={`${basePath}/audits/${audit.id}/findings`}>{audit.id}</Link>
                </td>
                <td>
                  <span className="ws-inline">
                    <Tag tone={STATUS_TONE[audit.status] ?? 'neutral'}>{audit.status}</Tag>
                    {audit.degraded ? <Tag tone="medium">degraded</Tag> : null}
                  </span>
                </td>
                <td>{audit.mode}</td>
                <td className="ws-mono">{shortSha(audit.requestedCommitSha)}</td>
                <td className="ws-nowrap">{formatUtc(audit.startedAt)}</td>
                <td className="ws-actions">
                  <Link href={`${basePath}/audits/${audit.id}/gate`}>Gate</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
