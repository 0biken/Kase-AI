import type { ReactNode } from 'react';
import Link from 'next/link';
import { KaseMark } from '@/components/kase-mark';
// Loaded after globals.css so the depth/glow layer overrides the flat base.
import './dashboard.css';

export type DashSection = 'overview' | 'audits' | 'findings';

/**
 * Nav items the platform does not serve yet are rendered as disabled, not as
 * links. Previously they were <span>s styled identically to real links —
 * indistinguishable, and a dead click every time.
 */
type NavItem = { label: string; path: string | null; section?: DashSection; external?: boolean };

const NAV: NavItem[] = [
  { label: 'Overview', path: '', section: 'overview' },
  { label: 'Audits', path: '/audits', section: 'audits' },
  { label: 'Findings', path: '/findings', section: 'findings' },
  { label: 'Reports', path: null },
  { label: 'Documentation', path: '/docs', external: true },
];

interface ShellProps {
  title: string;
  eyebrow?: string;
  email: string;
  active: DashSection;
  /** '/dashboard' for the real workspace, '/dashboard/preview' for the dev preview. */
  basePath?: string;
  /** Shown beside the title, e.g. the "Sample data" marker in the preview. */
  badge?: ReactNode;
  children: ReactNode;
}

/** Sidebar and page header shared by every workspace screen. */
export function DashShell({ title, eyebrow = 'Workspace', email, active, basePath = '/dashboard', badge, children }: ShellProps) {
  return (
    <div className="dash">
      <aside className="dash-side">
        <Link className="dash-brand" href="/">
          <KaseMark size={22} />
          <span>Kase</span>
        </Link>

        <nav className="dash-nav" aria-label="Workspace">
          {NAV.map((item) =>
            item.path === null ? (
              <span key={item.label} className="dash-nav-item is-disabled" aria-disabled="true">
                {item.label}
                <span className="dash-nav-soon">Soon</span>
              </span>
            ) : (
              <Link
                key={item.label}
                className="dash-nav-item"
                href={item.external ? item.path : `${basePath}${item.path}`}
                aria-current={item.section === active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <p className="dash-side-note">
          Workspace data appears here once a repository and target are connected.
        </p>
      </aside>

      <main className="dash-main">
        <header className="dash-header">
          <div>
            <p className="dash-eyebrow">{eyebrow}</p>
            <h1 className="dash-title">{title}{badge}</h1>
          </div>
          <div className="dash-account">
            <span className="dash-account-email">{email}</span>
            <span className="dash-account-meta">Invite-only workspace</span>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
