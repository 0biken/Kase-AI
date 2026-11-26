import Link from 'next/link';
import { SEVERITY_ORDER, bySeverity, type FindingFilters, type FindingRow } from '@/lib/workspace-types';
import { SeverityChip, StateCard, Tag } from './primitives';

/**
 * A plain GET form: the filters live in the URL, so a filtered view can be
 * shared or reloaded, and it works before (or without) client JavaScript.
 */
export function FindingsFilters({ action, filters, categories }: { action: string; filters: FindingFilters; categories: string[] }) {
  const active = Boolean(filters.severity || filters.category || filters.gateEligible);
  return (
    <form className="ws-filters" method="get" action={action}>
      <div className="ws-filter">
        <label htmlFor="f-severity">Severity</label>
        <select id="f-severity" name="severity" defaultValue={filters.severity ?? ''}>
          <option value="">All</option>
          {SEVERITY_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="ws-filter">
        <label htmlFor="f-category">Category</label>
        <select id="f-category" name="category" defaultValue={filters.category ?? ''}>
          <option value="">All</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="ws-filter">
        <label htmlFor="f-gate">Gate</label>
        <select id="f-gate" name="gateEligible" defaultValue={filters.gateEligible ?? ''}>
          <option value="">All</option>
          <option value="true">Can block</option>
          <option value="false">Advisory only</option>
        </select>
      </div>
      <button className="button ws-filter-apply" type="submit">Apply</button>
      {active ? <Link className="ws-filter-clear" href={action}>Clear</Link> : null}
    </form>
  );
}

export function FindingsTable({ findings, filtered }: { findings: FindingRow[]; filtered: boolean }) {
  if (findings.length === 0) {
    return filtered ? (
      <StateCard title="No findings match these filters">
        <p>Change or clear the filters to see the rest of this audit&apos;s findings.</p>
      </StateCard>
    ) : (
      <StateCard title="No findings recorded">
        <p>This audit has not recorded any findings. If it is still running, they appear as each stage completes.</p>
      </StateCard>
    );
  }

  const rows = [...findings].sort(bySeverity);
  return (
    <section className="card">
      <div className="ws-table-wrap">
        <table className="ws-table">
          <caption className="ws-visually-hidden">{rows.length} findings, most severe first</caption>
          <thead>
            <tr>
              <th scope="col">Severity</th>
              <th scope="col">Finding</th>
              <th scope="col">Category</th>
              <th scope="col">Source</th>
              <th scope="col" className="ws-num">Evidence</th>
              <th scope="col">Gate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const source = f.sourceLocations[0];
              return (
                <tr key={f.id}>
                  <td><SeverityChip severity={f.severity} /></td>
                  <td className="ws-finding">
                    <span className="ws-finding-title">{f.title}</span>
                    <span className="ws-finding-meta">
                      <span className="ws-mono">{f.id}</span>
                      <span>{f.origin}</span>
                      {f.aiGenerated ? <Tag>AI-assisted</Tag> : null}
                    </span>
                  </td>
                  <td>{f.category}</td>
                  <td className="ws-source">
                    {source ? (
                      <>
                        <span className="ws-mono">{source.file}:{source.line}</span>
                        <span className="ws-finding-meta">
                          <span className="ws-mono">{source.enclosingSymbol}</span>
                          {source.verified ? <Tag tone="pass">verified</Tag> : <Tag>unverified</Tag>}
                        </span>
                      </>
                    ) : (
                      <span className="ws-muted">No source location</span>
                    )}
                  </td>
                  <td className="ws-num ws-mono">{f.findingEvidence.length}</td>
                  <td>{f.gateEligible ? <Tag tone="critical">can block</Tag> : <span className="ws-muted">advisory</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
