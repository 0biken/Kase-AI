import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import CorrelationVisual from './correlation-visual';
// Loaded after globals.css so the depth/glow layer overrides the flat base.
import './dashboard.css';

/**
 * Nav items the platform does not serve yet are rendered as disabled, not as
 * links. Previously they were <span>s styled identically to real links —
 * indistinguishable, and a dead click every time.
 */
type NavItem = { label: string; href: string | null; active?: boolean };

const NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard', active: true },
  { label: 'Audits', href: null },
  { label: 'Findings', href: null },
  { label: 'Reports', href: null },
  { label: 'Documentation', href: '/docs' },
];

/**
 * Honest platform state. `done` items are shipped and verifiable today;
 * `next` is not started. No invented progress.
 */
const READINESS = [
  { state: 'done', label: 'Authentication', detail: 'Invite-only sign-in, RS256 sessions' },
  { state: 'done', label: 'Project foundation', detail: 'Projects, targets, scope policies, API tokens' },
  { state: 'next', label: 'Audit runtime', detail: 'Workers and evidence storage' },
] as const;

const DOCS = [
  { title: 'Architecture', detail: 'The execution pipeline and system boundaries', href: '/docs#architecture' },
  { title: 'Evidence model', detail: 'How artifacts become defensible findings', href: '/docs#evidence' },
  { title: 'Correlation', detail: 'The route to source-symbol join', href: '/docs#correlation' },
];

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect('/signin');

  const email = session.user?.email ?? 'Kase member';

  return (
    <div className="dash">
      <Sidebar />
      <main className="dash-main">
        <header className="dash-header">
          <div>
            <p className="dash-eyebrow">Workspace</p>
            <h1 className="dash-title">Overview</h1>
          </div>
          <div className="dash-account">
            <span className="dash-account-email">{email}</span>
            <span className="dash-account-meta">Invite-only workspace</span>
          </div>
        </header>

        <div className="dash-stack">
          <Setup />
          <div className="dash-split">
            <Readiness />
            <Documentation />
          </div>
        </div>
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="dash-side">
      <Link className="dash-brand" href="/">
        <span className="dash-brand-mark">K</span>
        <span>kase</span>
      </Link>

      <nav className="dash-nav" aria-label="Workspace">
        {NAV.map((item) =>
          item.href ? (
            <Link
              key={item.label}
              className="dash-nav-item"
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ) : (
            <span key={item.label} className="dash-nav-item is-disabled" aria-disabled="true">
              {item.label}
              <span className="dash-nav-soon">Soon</span>
            </span>
          ),
        )}
      </nav>

      <p className="dash-side-note">
        Workspace data appears here once a repository and target are connected.
      </p>
    </aside>
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
                {item.state === 'done' ? 'Ready' : 'Not started'}
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
