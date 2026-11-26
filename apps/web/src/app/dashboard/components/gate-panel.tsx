import type { FindingRow, GateEvaluationRow } from '@/lib/workspace-types';
import { SeverityChip, StateCard, formatUtc, shortSha } from './primitives';

const OUTCOME_COPY = {
  pass: { label: 'Pass', summary: 'Nothing in this audit blocks the release under the active policy.' },
  fail: { label: 'Fail', summary: 'At least one finding blocks the release under the active policy.' },
  partial: { label: 'Partial', summary: 'Required checks did not all run, so the gate could not reach a full decision.' },
} as const;

export function GateNotEvaluated({ auditId }: { auditId: string }) {
  return (
    <StateCard title="This audit has not been evaluated">
      <p>A gate result appears here after the release gate is evaluated for this audit. An operator or admin can run it from the CLI:</p>
      <pre className="ws-command"><code>kase gate evaluate --audit {auditId}</code></pre>
    </StateCard>
  );
}

/**
 * The latest stored gate evaluation. The API keeps finding ids on the
 * evaluation, so titles and severities are joined in from the audit's findings.
 */
export function GatePanel({ gate, findings }: { gate: GateEvaluationRow; findings: FindingRow[] }) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const copy = OUTCOME_COPY[gate.outcome] ?? { label: gate.outcome, summary: '' };

  return (
    <div className="ws-stack">
      <section className={`card ws-outcome ws-outcome-${gate.outcome}`}>
        <div className="card-body">
          <p className="ws-outcome-label">Release gate</p>
          <p className="ws-outcome-value">{copy.label}</p>
          <p className="card-text">{copy.summary}</p>
          <dl className="ws-facts ws-facts-inline">
            <div><dt>Policy version</dt><dd className="ws-mono">v{gate.gatePolicyVersion}</dd></div>
            <div><dt>Commit</dt><dd className="ws-mono">{shortSha(gate.commitSha)}</dd></div>
            <div><dt>Evaluated</dt><dd>{formatUtc(gate.evaluatedAt)}</dd></div>
          </dl>
        </div>
      </section>

      <div className="dash-split">
        <FindingIdList title="Blocking findings" empty="No finding blocks this release." ids={gate.blockingFindingIds} byId={byId} />
        <FindingIdList title="Waived findings" empty="No waivers were applied." ids={gate.waivedFindingIds} byId={byId} />
      </div>

      {gate.notExecutedCategories.length > 0 ? (
        <section className="card">
          <div className="card-body">
            <h2 className="card-heading">Required categories that did not run</h2>
            <ul className="ws-pill-list">
              {gate.notExecutedCategories.map((c) => <li key={c} className="ws-chip ws-chip-medium">{c}</li>)}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FindingIdList({ title, empty, ids, byId }: { title: string; empty: string; ids: string[]; byId: Map<string, FindingRow> }) {
  return (
    <section className="card">
      <div className="card-body">
        <h2 className="card-heading">{title} <span className="ws-count">{ids.length}</span></h2>
        {ids.length === 0 ? (
          <p className="ws-muted">{empty}</p>
        ) : (
          <ul className="ws-id-list">
            {ids.map((id) => {
              const f = byId.get(id);
              return (
                <li key={id}>
                  {f ? <SeverityChip severity={f.severity} /> : null}
                  <span className="ws-id-text">
                    <span>{f ? f.title : 'Finding not in this list'}</span>
                    <span className="ws-mono ws-muted">{id}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
