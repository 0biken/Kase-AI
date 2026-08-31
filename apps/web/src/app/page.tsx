import Link from 'next/link';
import { auth } from '@/auth';
import { IntakeForm } from './marketing-client';

const faqs = [
  ['What does Kase audit?', 'Kase is being built to combine runtime QA, deterministic scanners, and source-aware correlation into one evidence-backed release decision.'],
  ['Will an AI finding block a release?', 'No. Only policy-eligible findings with replayable evidence can block. AI contributes reasoning, not the system of record.'],
  ['Can we use our existing test suite?', 'Yes. Kase is designed to add evidence from browser, API, static analysis, dependency, and CI sources rather than replacing your existing checks.'],
  ['How do you handle sensitive evidence?', 'The platform design uses capture-time redaction, scoped storage, audit trails, and short-lived access. Secret storage is a current foundation milestone.'],
];

export default async function Home() {
  const session = await auth();

  return (
    <main className="site-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="wordmark" href="/" aria-label="Kase home"><span className="mark">K</span>kase</Link>
        <div className="nav-links">
          <Link href="/docs">Documentation</Link>
          <a href="#faq">FAQ</a>
          <a href={session ? '/dashboard' : '#request'} className="nav-cta">{session ? 'Open workspace' : 'Join waitlist'}</a>
        </div>
      </nav>

      <section className="hero">
        <div>
          <div className="eyebrow">Evidence-led release assurance</div>
          <h1>Know what ships. <span style={{ color: 'var(--accent)' }}>Prove why.</span></h1>
          <p className="hero-copy">Kase connects observed failures to source evidence, so release decisions are defensible to engineers and leadership.</p>
          <div className="button-row">
            <a className="button button-primary" href={session ? '/dashboard' : '#request'}>{session ? 'Open workspace' : 'Join waitlist'} <span className="button-arrow" aria-hidden="true">↗</span></a>
            <Link className="button" href="/docs">Read the architecture</Link>
          </div>
        </div>
        <div className="bezel"><div className="bezel-inner signal-panel"><div className="signal-top"><span className="signal-title">Release assurance</span><span className="live-state">Evidence required</span></div><div className="gate-word">Prove<br /><span>the path.</span></div><p className="signal-summary">Observed behavior, validated source context, and replayable artifacts stay connected from audit to gate.</p><div className="signal-rule" /><div className="signal-row"><span>Runtime evidence</span><strong>REPLAYABLE</strong></div><div className="signal-row"><span>Source correlation</span><strong>VERIFIED</strong></div></div></div>
      </section>

      <section className="section" id="approach"><div className="section-header"><div className="eyebrow">The Kase approach</div><h2>One audit trail from behavior to decision.</h2><p className="section-intro">Kase gives each layer a job. Tools observe. Agents reason. Evidence and policy decide.</p></div><div className="feature-grid"><div className="feature-list"><article className="feature-row"><span className="feature-index">01</span><div><h3>Observe the running system</h3><p>Browser and API evidence create a concrete record of what the target actually did.</p></div></article><article className="feature-row"><span className="feature-index">02</span><div><h3>Map it to the codebase</h3><p>Runtime routes and code maps link an observed fault to the responsible symbol, not just a nearby file.</p></div></article><article className="feature-row"><span className="feature-index">03</span><div><h3>Gate with evidence</h3><p>Policy evaluates severity, provenance, replayability, waivers, and execution coverage deterministically.</p></div></article></div><div className="bezel"><div className="bezel-inner proof-card"><div className="eyebrow">Design principle</div><h3>AI is the reasoning layer. It is never the system of record.</h3><div className="proof-list"><div className="proof-item"><b>01</b><span>Validated finding schema</span></div><div className="proof-item"><b>02</b><span>Immutable evidence references</span></div><div className="proof-item"><b>03</b><span>Policy-driven release outcome</span></div></div></div></div></div></section>

      <section className="section" id="request"><div className="form-layout"><div className="form-copy"><div className="eyebrow">Private access</div><h2>Build a release gate your team can trust.</h2><p>Join the waitlist, request a product conversation, or send a security concern to the Kase team.</p><Link className="button" href="/docs">Explore technical documentation</Link></div><IntakeForm /></div></section>

      <section className="section" id="faq"><div className="section-header"><div className="eyebrow">Frequently asked questions</div><h2>Clarity before access.</h2></div><div className="faq-list">{faqs.map(([question, answer]) => <details className="faq" key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
      <footer className="footer"><span>kase - evidence-led quality assurance</span><div className="footer-links"><Link href="/docs">Documentation</Link><Link href="/brand">Brand guide</Link><a href="#request">Request or report</a></div></footer>
    </main>
  );
}
