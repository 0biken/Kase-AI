\
# -*- coding: utf-8 -*-
import json, os

HERE = os.path.dirname(__file__)
with open(os.path.join(HERE, 'sections.json'), 'r', encoding='utf-8') as f:
    SECTIONS = json.load(f)
SMAP = {s['id']: s for s in SECTIONS}

NAV = [
    ('home', '', 'Kase'),
    ('s00', '00', 'Overview'),
    ('s01', '01', 'Architecture'),
    ('s02', '02', 'Technology Stack'),
    ('s03', '03', 'Data Model'),
    ('s04', '04', 'Audit Orchestrator'),
    ('s05', '05', 'Agent Runtime'),
    ('s06', '06', 'Recon & Inventory'),
    ('s07', '07', 'Tool Adapters'),
    ('s08', '08', 'Evidence Store'),
    ('s09', '09', 'Finding Engine'),
    ('s10', '10', 'Correlation Engine'),
    ('s11', '11', 'AI Layer'),
    ('s12', '12', 'Policy & Gate'),
    ('s13', '13', 'Integrations'),
    ('s14', '14', 'REST API'),
    ('s15', '15', 'CLI'),
    ('s16', '16', 'Web Dashboard'),
    ('s17', '17', 'Security Model'),
    ('s18', '18', 'Observability'),
    ('s19', '19', 'Roadmap'),
    ('s20', '20', 'Decision Records'),
    ('prd', 'PRD', 'Product Requirements'),
]

EYEBROW = {
    'home': 'KASE',
    'prd': 'APPENDIX · SUPERSEDED BY DOCS',
}
for sid, num, _ in NAV:
    if sid not in EYEBROW:
        EYEBROW[sid] = f'SECTION {num}'

# ---------------- sidebar ----------------
nav_items = []
for sid, num, name in NAV:
    numeral = f'<span class="nav-num">{num}</span>' if num else '<span class="nav-num nav-num--mark">&#9635;</span>'
    extra = ' nav-link--muted' if sid == 'prd' else ''
    nav_items.append(
        f'<a class="nav-link{extra}" data-target="{sid}" href="#{sid}">{numeral}<span class="nav-name">{name}</span></a>'
    )
nav_html = '\n'.join(nav_items)

# ---------------- main sections ----------------
section_blocks = []
for sid, num, name in NAV:
    s = SMAP[sid]
    eyebrow = EYEBROW[sid]
    numeral_big = f'<span class="section-numeral">{num}</span>' if num else '<span class="section-numeral section-numeral--mark">&#9635;</span>'
    extra_class = ' section--legacy' if sid == 'prd' else ''
    section_blocks.append(f'''
<section class="doc-section{extra_class}" id="{sid}" data-title="{name}">
  <header class="section-head">
    {numeral_big}
    <div class="section-head-text">
      <p class="eyebrow">{eyebrow}</p>
      <h1>{s['title']}</h1>
    </div>
  </header>
  <div class="section-body">
    {s['html']}
  </div>
</section>''')
main_html = '\n'.join(section_blocks)

TEMPLATE = r'''<title>Kase Documentation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* ============================================================
   KASE DOCUMENTATION -- design tokens
   Source Serif 4 (display) / IBM Plex Sans (body) / IBM Plex Mono (data)
   ============================================================ */
:root{
  --paper: #F4F5F1;
  --paper-raised: #FFFFFF;
  --paper-sunken: #ECEEE8;
  --ink: #1B1F1E;
  --ink-soft: #565F5C;
  --ink-faint: #8A928D;
  --rule: #DBDFD8;
  --rule-strong: #C3C9BF;
  --accent: #1F4E5C;
  --accent-strong: #143840;
  --accent-soft: #E3ECEC;
  --sev-critical: #A33B32;      --sev-critical-soft: #F3E3E0;
  --sev-high: #A56A1F;          --sev-high-soft: #F3E9D6;
  --sev-medium: #7C6E22;        --sev-medium-soft: #EFECD3;
  --sev-low: #4B5A63;           --sev-low-soft: #E4E9EA;
  --sev-info: #5B6460;          --sev-info-soft: #E7E9E5;
  --sev-pass: #2E6B54;          --sev-pass-soft: #DEEEE7;
  --sev-fail: #A33B32;          --sev-fail-soft: #F3E3E0;
  --sev-partial: #A56A1F;       --sev-partial-soft: #F3E9D6;
  --shadow: 0 1px 2px rgba(27,31,30,.06), 0 6px 20px -10px rgba(27,31,30,.18);
  --radius: 4px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper: #14171A;
    --paper-raised: #1B1F22;
    --paper-sunken: #0F1214;
    --ink: #E7E9E4;
    --ink-soft: #9BA39C;
    --ink-faint: #667069;
    --rule: #292F2D;
    --rule-strong: #3A413E;
    --accent: #86C7D0;
    --accent-strong: #B3DEE4;
    --accent-soft: #1C2E30;
    --sev-critical: #E08A7D;     --sev-critical-soft: #33211E;
    --sev-high: #E0B36F;         --sev-high-soft: #332812;
    --sev-medium: #D6C978;       --sev-medium-soft: #2E2A14;
    --sev-low: #9FB4BC;          --sev-low-soft: #1D2528;
    --sev-info: #9BA39C;         --sev-info-soft: #202422;
    --sev-pass: #7FD1AF;         --sev-pass-soft: #1A2B24;
    --sev-fail: #E08A7D;         --sev-fail-soft: #33211E;
    --sev-partial: #E0B36F;      --sev-partial-soft: #332812;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 24px -10px rgba(0,0,0,.5);
    color-scheme: dark;
  }
}
:root[data-theme="dark"]{
  --paper: #14171A;
  --paper-raised: #1B1F22;
  --paper-sunken: #0F1214;
  --ink: #E7E9E4;
  --ink-soft: #9BA39C;
  --ink-faint: #667069;
  --rule: #292F2D;
  --rule-strong: #3A413E;
  --accent: #86C7D0;
  --accent-strong: #B3DEE4;
  --accent-soft: #1C2E30;
  --sev-critical: #E08A7D;     --sev-critical-soft: #33211E;
  --sev-high: #E0B36F;         --sev-high-soft: #332812;
  --sev-medium: #D6C978;       --sev-medium-soft: #2E2A14;
  --sev-low: #9FB4BC;          --sev-low-soft: #1D2528;
  --sev-info: #9BA39C;         --sev-info-soft: #202422;
  --sev-pass: #7FD1AF;         --sev-pass-soft: #1A2B24;
  --sev-fail: #E08A7D;         --sev-fail-soft: #33211E;
  --sev-partial: #E0B36F;      --sev-partial-soft: #332812;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 24px -10px rgba(0,0,0,.5);
  color-scheme: dark;
}

*,*::before,*::after{ box-sizing: border-box; }
html{ -webkit-text-size-adjust: 100%; }
body{
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-reduced-motion: reduce){
  *{ scroll-behavior: auto !important; animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
html{ scroll-behavior: smooth; }

a{ color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover{ color: var(--accent-strong); }
a:focus-visible, button:focus-visible, .nav-link:focus-visible{
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 2px;
}

h1,h2,h3,h4{
  font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
  font-weight: 600;
  color: var(--ink);
  text-wrap: balance;
  line-height: 1.22;
}
h1{ font-size: clamp(1.9rem, 1.5rem + 1.6vw, 2.7rem); margin: 0; }
h2{ font-size: 1.5rem; margin: 2.6rem 0 1rem; padding-top: 1.4rem; border-top: 1px solid var(--rule); }
h2:first-child{ margin-top: 0; padding-top: 0; border-top: none; }
h3{ font-size: 1.2rem; margin: 2rem 0 .8rem; color: var(--ink); }
h4{ font-size: 1.02rem; margin: 1.6rem 0 .6rem; font-weight: 600; font-style: italic; color: var(--ink-soft); }

.anchor{
  float: left;
  margin-left: -1.15em;
  padding-right: .3em;
  opacity: 0;
  color: var(--ink-faint);
  text-decoration: none;
  font-family: "IBM Plex Mono", monospace;
  font-weight: 400;
  transition: opacity .12s ease;
}
h1 .anchor, h2 .anchor, h3 .anchor, h4 .anchor{ font-size: .82em; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor{ opacity: .6; }
.anchor:hover{ opacity: 1 !important; }

p{ margin: 0 0 1rem; max-width: 74ch; }
ul,ol{ margin: 0 0 1.2rem; padding-left: 1.35rem; }
li{ margin-bottom: .38rem; max-width: 72ch; }
li > ul, li > ol{ margin-top: .4rem; }
strong{ font-weight: 600; color: var(--ink); }

blockquote{
  margin: 1.4rem 0 1.6rem;
  padding: 1.1rem 1.4rem;
  background: var(--paper-raised);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius) var(--radius) 0;
  box-shadow: var(--shadow);
}
blockquote > *:last-child{ margin-bottom: 0; }
blockquote h3{ margin-top: 0; font-size: 1.05rem; }
blockquote p{ color: var(--ink-soft); }
blockquote p:first-of-type{ color: var(--ink); }

hr.rule{ border: none; border-top: 1px solid var(--rule); margin: 2.2rem 0; }

/* inline code + semantic badges */
code{
  font-family: "IBM Plex Mono", ui-monospace, Consolas, monospace;
  font-size: .86em;
  background: var(--paper-sunken);
  color: var(--accent-strong);
  padding: .12em .38em;
  border-radius: 3px;
  white-space: nowrap;
}
code.badge{
  display: inline-flex;
  align-items: center;
  gap: .38em;
  background: var(--paper-sunken);
  color: var(--ink);
  font-weight: 500;
}
code.badge i{
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: currentColor;
}
code.badge.sev-critical{ background: var(--sev-critical-soft); color: var(--sev-critical); }
code.badge.sev-high{     background: var(--sev-high-soft);     color: var(--sev-high); }
code.badge.sev-medium{   background: var(--sev-medium-soft);   color: var(--sev-medium); }
code.badge.sev-low{      background: var(--sev-low-soft);      color: var(--sev-low); }
code.badge.sev-info{     background: var(--sev-info-soft);     color: var(--sev-info); }
code.badge.sev-pass{     background: var(--sev-pass-soft);     color: var(--sev-pass); }
code.badge.sev-fail{     background: var(--sev-fail-soft);     color: var(--sev-fail); }
code.badge.sev-partial{  background: var(--sev-partial-soft);  color: var(--sev-partial); }

/* code blocks */
.code-block{
  position: relative;
  margin: 1.2rem 0 1.5rem;
  background: var(--paper-sunken);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  overflow-x: auto;
}
.code-block pre{ margin: 0; padding: 1rem 1.1rem; }
.code-block code{
  background: none; padding: 0; color: var(--ink); white-space: pre;
  font-size: .84rem; line-height: 1.55; border-radius: 0;
}
.lang-tag{
  position: absolute; top: .55rem; right: .7rem;
  font-family: "IBM Plex Mono", monospace;
  font-size: .64rem; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-faint);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  padding: .15em .5em;
  border-radius: 3px;
  pointer-events: none;
}

/* tables */
.table-wrap{ overflow-x: auto; margin: 1.3rem 0 1.6rem; border: 1px solid var(--rule); border-radius: var(--radius); }
table{ border-collapse: collapse; width: 100%; min-width: 100%; font-size: .92rem; }
th, td{ padding: .55rem .85rem; text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); }
th{
  font-family: "IBM Plex Mono", monospace;
  font-size: .72rem; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink-soft); font-weight: 500;
  background: var(--paper-sunken);
  white-space: nowrap;
}
tbody tr:last-child td{ border-bottom: none; }
tbody tr:hover{ background: var(--accent-soft); }
td code{ white-space: normal; }
table :is(td,th) *{ max-width: none; }
td, th{ font-variant-numeric: tabular-nums; }

/* ============================================================
   LAYOUT
   ============================================================ */
.shell{ display: flex; min-height: 100vh; align-items: flex-start; }

.sidebar{
  position: sticky; top: 0;
  width: 258px; flex: none;
  height: 100vh; overflow-y: auto;
  padding: 1.6rem 1rem 2rem 1.6rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
}
.brand{ display: block; text-decoration: none; margin-bottom: 1.4rem; }
.brand-mark{
  font-family: "Source Serif 4", serif;
  font-weight: 700; font-size: 1.5rem; color: var(--ink);
  letter-spacing: -.01em;
}
.brand-sub{
  display: block; margin-top: .2rem;
  font-family: "IBM Plex Mono", monospace;
  font-size: .66rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint);
}
nav.toc{ display: flex; flex-direction: column; gap: .1rem; }
.nav-link{
  display: flex; align-items: baseline; gap: .6rem;
  padding: .34rem .55rem;
  border-radius: 3px;
  text-decoration: none;
  color: var(--ink-soft);
  font-size: .89rem;
  transition: background .12s ease, color .12s ease;
}
.nav-link:hover{ background: var(--paper-sunken); color: var(--ink); }
.nav-link.is-active{ background: var(--accent-soft); color: var(--accent-strong); font-weight: 500; }
.nav-num{
  font-family: "IBM Plex Mono", monospace;
  font-size: .72rem; color: var(--ink-faint);
  width: 1.5em; flex: none; font-variant-numeric: tabular-nums;
}
.nav-link.is-active .nav-num{ color: var(--accent); }
.nav-num--mark{ font-size: .6rem; }
.nav-link--muted{ opacity: .68; }
.nav-link--muted .nav-name{ font-style: italic; }
.sidebar-foot{
  margin-top: 1.6rem; padding-top: 1rem; border-top: 1px solid var(--rule);
  font-family: "IBM Plex Mono", monospace; font-size: .68rem;
  color: var(--ink-faint); line-height: 1.7;
}

main{ flex: 1; min-width: 0; }
.main-inner{ max-width: 900px; margin: 0 auto; padding: 3.2rem 3rem 8rem; }

.doc-section{ padding-top: 1.2rem; scroll-margin-top: 1.2rem; }
.doc-section + .doc-section{ margin-top: 5rem; padding-top: 3.4rem; border-top: 1px solid var(--rule-strong); }

.section-head{
  display: flex; align-items: flex-start; gap: 1.3rem;
  margin-bottom: 2.2rem;
}
.section-numeral{
  font-family: "IBM Plex Mono", monospace;
  font-size: 2.4rem; font-weight: 500; line-height: 1;
  color: var(--rule-strong);
  padding-top: .28em;
  flex: none;
}
.section-numeral--mark{ font-size: 1.3rem; color: var(--accent); }
.eyebrow{
  margin: 0 0 .4rem;
  font-family: "IBM Plex Mono", monospace;
  font-size: .72rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint);
}
.section-head-text h1{ margin: 0; }
.section-head-text h1 .anchor{ display: none; }

.section--legacy .section-head-text h1{ color: var(--ink-soft); }
.section--legacy .section-numeral{ color: var(--sev-medium); }
.section--legacy .eyebrow{ color: var(--sev-medium); }
.section--legacy .section-body{ color: var(--ink-soft); }

.page-header{
  padding: 3.2rem 3rem 0;
  max-width: 900px; margin: 0 auto;
}

@media (max-width: 900px){
  .shell{ flex-direction: column; }
  .sidebar{
    position: static; width: auto; height: auto;
    display: flex; overflow-x: auto; overflow-y: hidden;
    padding: 1rem 1rem .9rem;
    align-items: center; gap: .2rem;
    border-right: none; border-bottom: 1px solid var(--rule);
  }
  .brand{ margin: 0 1rem 0 0; flex: none; }
  nav.toc{ flex-direction: row; }
  .nav-link{ white-space: nowrap; }
  .sidebar-foot{ display: none; }
  .main-inner{ padding: 2.2rem 1.4rem 6rem; }
  .section-numeral{ display: none; }
}
</style>

<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="#home">
      <span class="brand-mark">Kase</span>
      <span class="brand-sub">Technical Documentation</span>
    </a>
    <nav class="toc">
      __NAV__
    </nav>
    <div class="sidebar-foot">
      22 sections<br>12 decision records<br>rev. 2026-08-24
    </div>
  </aside>

  <main>
    <div class="main-inner">
      __SECTIONS__
    </div>
  </main>
</div>

<script>
(function(){
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.doc-section'));
  var byId = {};
  links.forEach(function(l){ byId[l.getAttribute('data-target')] = l; });

  var current = null;
  function setActive(id){
    if(id === current) return;
    if(current && byId[current]) byId[current].classList.remove('is-active');
    if(byId[id]) byId[id].classList.add('is-active');
    current = id;
  }

  if('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      var best = null, bestRatio = 0;
      entries.forEach(function(e){
        if(e.isIntersecting && e.intersectionRatio > bestRatio){
          bestRatio = e.intersectionRatio; best = e.target.id;
        }
      });
      if(best) setActive(best);
    }, { rootMargin: '-10% 0px -70% 0px', threshold: [0, .1, .25, .5, .75, 1] });
    sections.forEach(function(s){ io.observe(s); });
  }

  if(location.hash){
    var id = location.hash.slice(1).split('-')[0];
  }
  setActive(sections.length ? sections[0].id : 'home');
})();
</script>
'''

out = TEMPLATE.replace('__NAV__', nav_html).replace('__SECTIONS__', main_html)
out_path = os.path.join(os.path.dirname(HERE), 'kase-docs.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(out)
print('wrote', out_path, len(out), 'bytes')
