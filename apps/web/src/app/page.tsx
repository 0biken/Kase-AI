import Link from 'next/link';
import { ArrowUpRight, Eye, ShieldCheck, TreeStructure } from '@phosphor-icons/react/ssr';
import { auth } from '@/auth';
import { KaseMark } from '@/components/kase-mark';
import { WaitlistForm } from './marketing-client';
import './marketing.css';

const STEPS = [
  { icon: Eye, title: 'Observe', body: 'Browser and API runs record what the target actually did, as replayable evidence.' },
  { icon: TreeStructure, title: 'Correlate', body: 'Each observed fault is joined to the route handler and source symbol responsible for it.' },
  { icon: ShieldCheck, title: 'Decide', body: 'A versioned policy turns validated findings into a pass or fail your CI can enforce.' },
] as const;

const SEVERITIES = [
  ['critical', 'Critical'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
  ['pass', 'Pass'],
] as const;

const FAQS = [
  ['What does Kase audit?', 'Running web apps and APIs, plus the repository behind them. Runtime QA, deterministic scanners, and source-aware correlation feed one release decision.'],
  ['Will an AI finding block a release?', 'No. Agents investigate and explain. Only policy-eligible findings with replayable evidence can block, and AI output is never the system of record.'],
  ['Does it replace our existing tests?', 'No. Kase adds evidence from browser, API, static analysis, dependency, and CI sources alongside the checks you already run.'],
  ['How is sensitive evidence handled?', 'The platform is designed around capture-time redaction, per-project storage, short-lived access, and an audit trail on every read.'],
  ['Who is the waitlist for?', 'Engineering and security teams who own a release gate today and want each decision backed by evidence they can show.'],
] as const;

export default async function Home() {
  const session = await auth();
  const primaryHref = session ? '/dashboard' : '#waitlist';
  const primaryLabel = session ? 'Open workspace' : 'Join waitlist';

  return (
    <main className="lp">
      <header className="lp-nav-wrap">
        <nav className="lp-nav" aria-label="Primary navigation">
          <Link className="wordmark" href="/" aria-label="Kase home">
            <KaseMark size={26} />
            <span>Kase</span>
          </Link>
          <div className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#gate">Release gate</a>
            <a href="#faq">FAQ</a>
            <Link href="/docs">Docs</Link>
          </div>
          <a className="button button-primary button-small" href={primaryHref}>{primaryLabel}</a>
        </nav>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="eyebrow">Evidence-led release assurance</p>
          <h1><span className="lp-h1-line">Know what ships.</span> <span className="lp-h1-line lp-h1-accent">Prove why.</span></h1>
          <p className="lp-lede">
            Kase ties every runtime failure to the source that caused it, so release decisions hold up in review.
          </p>
          <div className="button-row">
            <a className="button button-primary" href={primaryHref}>
              {primaryLabel}
              <span className="button-arrow" aria-hidden="true"><ArrowUpRight size={14} weight="bold" /></span>
            </a>
            <Link className="button" href="/docs">Read the architecture</Link>
          </div>
        </div>

        <figure className="lp-terminal" aria-label="Example output of the kase gate evaluate command">
          <div className="lp-terminal-bar">
            <span>kase gate</span>
            <span className="lp-terminal-tag">Example output</span>
          </div>
          <pre className="lp-terminal-body"><code>
            <span className="t-line t-cmd"><span className="t-prompt">$</span> kase gate evaluate --audit aud_01JA4ZQ7M3K8</span>
            <span className="t-line"><span className="t-fail">gate: FAIL</span> <span className="t-dim">(mode=full)</span></span>
            <span className="t-line"> </span>
            <span className="t-line"><span className="t-block">BLOCK</span> critical authz fnd_01JA50B2XQ</span>
            <span className="t-line"><span className="t-dim">  rule:</span> severity=critical</span>
            <span className="t-line"><span className="t-dim">  evidence:</span> ev_7HQ2(http_replay:<span className="t-ok">reproduced</span>)</span>
            <span className="t-line"><span className="t-dim">  source:</span> src/invoices/invoices.controller.ts</span>
            <span className="t-line">          InvoicesController.findOne <span className="t-ok">(verified)</span></span>
            <span className="t-line"><span className="t-warn">warn:</span> advisory under mode=full: severity=medium</span>
            <span className="t-line"> </span>
            <span className="t-line t-dim">exit 1</span>
          </code></pre>
        </figure>
      </section>

      <section className="lp-section lp-how" id="how">
        <h2>One trail from behavior to decision.</h2>
        <p className="lp-section-lede">Tools observe. Agents reason. Evidence and policy decide.</p>
        <ol className="lp-steps">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <li className="lp-step" key={title}>
              <span className="lp-step-icon" aria-hidden="true"><Icon size={20} weight="regular" /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <div className="lp-trace" aria-label="Example correlation from an HTTP route to a source symbol">
          <code>GET /api/invoices/:id</code>
          <span className="lp-trace-join" aria-hidden="true" />
          <code>InvoicesController.findOne</code>
          <span className="lp-trace-join" aria-hidden="true" />
          <code>src/invoices/invoices.controller.ts:48</code>
        </div>
      </section>

      <section className="lp-section" id="gate">
        <h2>Only evidence can block a release.</h2>
        <div className="lp-bento">
          <article className="lp-cell lp-cell-lead">
            <h3>AI reasons. Evidence decides.</h3>
            <p>Agents investigate and explain what they found. Only validated findings with replayable evidence count toward the gate.</p>
          </article>
          <article className="lp-cell lp-cell-sev">
            <h3>Severity you set per project</h3>
            <ul className="sev-row" aria-label="Severity scale">
              {SEVERITIES.map(([key, label]) => <li className={`sev sev-${key}`} key={key}>{label}</li>)}
            </ul>
            <p>Policies are versioned, so every result names the rule that produced it.</p>
          </article>
          <article className="lp-cell">
            <h3>Not reproduced, not blocking.</h3>
            <p>HTTP evidence is replayed before it counts. A finding that does not reproduce drops out. A replay error fails closed.</p>
          </article>
          <article className="lp-cell">
            <h3>Waivers expire.</h3>
            <p>Accepted risk carries an approver and an end date, and it appears in every gate result until it lapses.</p>
          </article>
          <article className="lp-cell lp-cell-exit">
            <h3>Exit codes CI already reads</h3>
            <dl className="exit-codes">
              <div><dt>0</dt><dd>Pass</dd></div>
              <div><dt>1</dt><dd>Fail</dd></div>
              <div><dt>2</dt><dd>Partial</dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section className="lp-section lp-waitlist" id="waitlist">
        <div className="lp-waitlist-copy">
          <p className="eyebrow">Early access</p>
          <h2>Put Kase in front of your next release.</h2>
          <p>Kase is invite-only while the platform is built. Join the list and we will reach out when a place opens.</p>
          <p className="lp-waitlist-aside">
            Found a security issue in Kase itself? Choose &ldquo;Security&rdquo; in the form and it goes straight to the team.
          </p>
        </div>
        <WaitlistForm />
      </section>

      <section className="lp-section lp-faq" id="faq">
        <h2>Questions</h2>
        <div className="faq-list">
          {FAQS.map(([question, answer]) => (
            <details className="faq" key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <Link className="wordmark" href="/" aria-label="Kase home">
            <KaseMark size={22} />
            <span>Kase</span>
          </Link>
          <p>Every release. Every finding. Every proof.</p>
        </div>
        <div className="footer-links">
          <Link href="/docs">Documentation</Link>
          <Link href="/brand">Brand</Link>
          <a href="https://github.com/0biken/Kase-AI" target="_blank" rel="noreferrer">GitHub</a>
          {session ? null : <Link href="/signin">Sign in</Link>}
        </div>
      </footer>
    </main>
  );
}
