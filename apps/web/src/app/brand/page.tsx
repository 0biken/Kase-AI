import Link from 'next/link';
import { KaseMark } from '@/components/kase-mark';
import { Swatch } from './swatch';
import '../marketing.css';
import './brand.css';

const CORE = [
  ['--ink', 'Ink', 'Page background'],
  ['--canvas', 'Canvas', 'Section and card ground'],
  ['--surface', 'Surface', 'Raised panels and inputs'],
  ['--line', 'Line', 'Hairlines and borders'],
  ['--text', 'Text', 'Primary copy'],
  ['--muted', 'Muted', 'Secondary copy'],
  ['--accent', 'Kase teal', 'Actions and verified state only'],
] as const;

const SEVERITY = [
  ['--sev-critical', 'Critical', 'Blocking finding, failed gate'],
  ['--sev-high', 'High', 'Severity label only'],
  ['--sev-medium', 'Medium', 'Severity label, warnings'],
  ['--sev-low', 'Low', 'Severity label only'],
  ['--sev-pass', 'Pass', 'Same teal as the accent'],
] as const;

export default function BrandPage() {
  return (
    <main className="lp">
      <header className="lp-nav-wrap">
        <nav className="lp-nav" aria-label="Primary navigation">
          <Link className="wordmark" href="/" aria-label="Kase home"><KaseMark size={26} /><span>Kase</span></Link>
          <div className="lp-nav-links"><Link href="/">Home</Link><Link href="/docs">Docs</Link></div>
          <Link className="button button-primary button-small" href="/#waitlist">Join waitlist</Link>
        </nav>
      </header>

      <section className="br-intro">
        <p className="eyebrow">Brand system</p>
        <h1>Know what ships. <span>Prove why.</span></h1>
        <p>The primary line. Supporting line, for footers and sign-offs: <em>Every release. Every finding. Every proof.</em></p>
      </section>

      <section className="lp-section br-block">
        <h2>Mark</h2>
        <div className="br-mark-grid">
          <div className="br-mark-stage br-mark-dark"><KaseMark size={132} title="Kase mark" /></div>
          <div className="br-mark-stage br-mark-teal"><KaseMark size={132} /></div>
          <div className="br-mark-stage br-mark-lockup"><span className="wordmark br-lockup"><KaseMark size={56} /><span>Kase</span></span></div>
        </div>
        <ul className="br-rules">
          <li>A K whose lower leg is the handle of a magnifier. Investigation, built into the letter.</li>
          <li>Use it in one colour: text white on dark, ink on teal. Never two colours inside the mark.</li>
          <li>Clear space equals the lens diameter. Minimum size 16px for the mark, 20px for the lockup.</li>
          <li>Do not stretch, rotate, outline, shadow, or place it in a bordered box.</li>
          <li>The wordmark is set in title case: Kase. Never &ldquo;kase&rdquo; or &ldquo;KASE&rdquo;.</li>
        </ul>
      </section>

      <section className="lp-section br-block">
        <h2>Colour</h2>
        <p className="lp-section-lede">One signal colour. Teal marks an action or a verified state and nothing else.</p>
        <div className="br-swatches">{CORE.map(([t, n, u]) => <Swatch key={t} token={t} name={n} use={u} />)}</div>
        <h3 className="br-sub">Severity</h3>
        <p className="br-note">Severity colours label findings and gate outcomes. They are never decoration and never a second brand accent.</p>
        <div className="br-swatches">{SEVERITY.map(([t, n, u]) => <Swatch key={t} token={t} name={n} use={u} />)}</div>
      </section>

      <section className="lp-section br-block">
        <h2>Type</h2>
        <div className="br-type">
          <div>
            <p className="br-type-sample">Inter</p>
            <p className="br-note">Product and marketing copy. Display at 650 to 700 with tight tracking, body at 400.</p>
          </div>
          <div>
            <p className="br-type-sample br-type-mono">JetBrains Mono</p>
            <p className="br-note">Evidence, identifiers, commands, and exit codes. Never for headlines or body copy.</p>
          </div>
        </div>
      </section>

      <section className="lp-section br-block">
        <h2>Voice</h2>
        <dl className="br-voice">
          <div><dt>Precise</dt><dd>not vague</dd></div>
          <div><dt>Vigilant</dt><dd>not alarmist</dd></div>
          <div><dt>Evidence-led</dt><dd>not opinion-led</dd></div>
        </dl>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-brand"><Link className="wordmark" href="/"><KaseMark size={22} /><span>Kase</span></Link></div>
        <div className="footer-links"><Link href="/">Home</Link><Link href="/docs">Documentation</Link></div>
      </footer>
    </main>
  );
}
