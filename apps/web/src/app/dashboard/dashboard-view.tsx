import Link from 'next/link';
import CorrelationVisual from './correlation-visual';
import { DashShell } from './dash-shell';

/**
 * Honest platform state, taken from the gate ledgers (GATES*.md) and TASKS.md.
 * `done` has a closed ledger with a live proof. `built` is implemented and
 * passing locally but its ledger is still open. `next` is not started.
 * No invented progress: update a row only when its ledger changes.
 */
const READINESS = [
  { state: 'done', label: 'Authentication', detail: 'Invite-only sign-in, RS256 sessions' },
  { state: 'done', label: 'Project foundation', detail: 'Projects, targets, scope policies, API tokens' },
  { state: 'done', label: 'Audit runtime', detail: 'Workers, scanners, hash-verified evidence storage' },
  { state: 'done', label: 'Recon and inventory', detail: 'Canonical endpoint inventory with drift' },
  { state: 'built', label: 'Agent runtime', detail: 'Local gates pass; live provider proof deferred' },
  { state: 'built', label: 'Correlation', detail: 'Route to source-symbol join; gates open' },
  { state: 'built', label: 'Release gate', detail: 'Policies, waivers, evaluation API and CLI' },
  { state: 'built', label: 'Workspace screens', detail: 'Audits, findings and gate status; more to come' },
] as const;

const READINESS_LABEL = { done: 'Ready', built: 'In verification', next: 'Not started' } as const;

const DOCS = [
  { title: 'Architecture', detail: 'The execution pipeline and system boundaries', href: '/docs#architecture' },
  { title: 'Evidence model', detail: 'How artifacts become defensible findings', href: '/docs#evidence' },
  { title: 'Correlation', detail: 'The route to source-symbol join', href: '/docs#correlation' },
];

/** The Overview screen, with no auth of its own: callers decide who may see it. */
export function DashboardView({ email, basePath }: { email: string; basePath?: string }) {
  return (
    <DashShell title="Overview" email={email} active="overview" basePath={basePath}>
      <div className="dash-stack">
        <Setup />
        <div className="dash-split">
          <Readiness />
          <Documentation />
        </div>
      </div>
    </DashShell>
  );
}

/**
 * The primary surface. The product has auth and CRUD but no audit runner, so
 * the honest dashboard is a setup surface — not three metric cards reading
 * zero, which implies data that is merely late rather than absent.
 */
function Setup() {
  return (
    <section className="card card-setup">
      <div className="card-body">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="card-eyebrow">Get started</p>
            <h2 className="card-title">Connect a repository to run your first audit.</h2>
            <p className="card-text">
              Kase traces an externally observed defect to the exact source symbol that
              causes it. That join needs a repository, a target, and a scope policy
              naming what you are authorised to test.
            </p>
            <div className="card-actions">
              <Link className="button button-primary" href="/docs">
                Set up first audit
              </Link>
              <Link className="button" href="/docs">
                Read the documentation
              </Link>
            </div>
          </div>
          {/* The chain this product exists to produce, drawn rather than
              described. Depicts a real correlation from the spike fixture —
              no invented metrics, since the audit runner does not exist yet. */}
          <div className="hero-visual">
            <CorrelationVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

function Readiness() {
  return (
    <section className="card">
      <div className="card-body">
        <h2 className="card-heading">Platform readiness</h2>
        <ul className="ready-list">
          {READINESS.map((item) => (
            <li className="ready-item" key={item.label}>
              <span className={`ready-dot ready-dot-${item.state}`} aria-hidden="true" />
              <span className="ready-text">
                <span className="ready-label">{item.label}</span>
                <span className="ready-detail">{item.detail}</span>
              </span>
              <span className={`ready-state ready-state-${item.state}`}>
                {READINESS_LABEL[item.state]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Documentation() {
  return (
    <section className="card">
      <div className="card-body">
        <h2 className="card-heading">System design</h2>
        <div className="doc-list">
          {DOCS.map((doc) => (
            <Link className="doc-item" href={doc.href} key={doc.title}>
              <span className="doc-title">{doc.title}</span>
              <span className="doc-detail">{doc.detail}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
