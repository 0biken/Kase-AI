import Link from 'next/link';

const base = 'https://github.com/0biken/Kase-AI/blob/main/docs';
const sections = [
  ['overview', 'Product overview', 'What Kase is, who it serves, and its operating boundaries.', '00-overview/README.md'],
  ['architecture', 'Architecture', 'The execution pipeline, subsystem boundaries, and system-of-record model.', '01-architecture/README.md'],
  ['evidence', 'Evidence and data', 'Evidence classes, retention, the data model, and release-gate eligibility.', '03-data-model/README.md'],
  ['correlation', 'Correlation engine', 'Route mapping, code maps, provenance, deduplication, and source-level joins.', '10-correlation/README.md'],
  ['security', 'Security model', 'Worker isolation, auth, scope validation, and audit trails.', '17-security/README.md'],
  ['roadmap', 'Roadmap and ADRs', 'Milestones, tradeoffs, and the decisions that govern implementation.', '19-roadmap/README.md'],
];

export default function DocumentationPage() {
  return <main className="site-shell"><nav className="site-nav" aria-label="Primary navigation"><Link className="wordmark" href="/"><span className="mark">K</span>kase</Link><div className="nav-links"><Link href="/">Home</Link><Link href="/brand">Brand guide</Link><a className="nav-cta" href={`${base}/README.md`} target="_blank" rel="noreferrer">Open source docs</a></div></nav><section className="docs-page"><div className="eyebrow">Technical documentation</div><h1>The contract behind the release decision.</h1><p>Kase&apos;s repository documentation is the current source of truth. Read the system design, inspect the spikes, and follow the roadmap from foundation to release assurance.</p><div className="docs-directory">{sections.map(([id, title, description, path]) => <a id={id} href={`${base}/${path}`} target="_blank" rel="noreferrer" key={id}><strong>{title}</strong><span>{description}</span></a>)}</div></section><footer className="footer"><span>kase - technical documentation</span><div className="footer-links"><Link href="/">Home</Link><Link href="/brand">Brand guide</Link><a href="https://github.com/0biken/Kase-AI" target="_blank" rel="noreferrer">Repository</a></div></footer></main>;
}
