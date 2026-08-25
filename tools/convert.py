\
# -*- coding: utf-8 -*-
import re, os, html, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SECTIONS = [
    ("home", "Kase", os.path.join(ROOT, "README.md"), "Home"),
]
for name in sorted(os.listdir(os.path.join(ROOT, "docs"))):
    p = os.path.join(ROOT, "docs", name, "README.md")
    if os.path.isfile(p):
        num = name[:2]
        SECTIONS.append((f"s{num}", name, p, None))

SECTIONS.append(("prd", "prd", os.path.join(ROOT, "Kase MVP — Product Requirements Document.md"), "Appendix"))

# ---------- slug (GitHub-compatible) ----------
def gh_slug(text, used):
    s = text.lower()
    s = re.sub(r'[^a-z0-9 _-]', '', s)
    s = s.replace(' ', '-')
    if s not in used:
        used[s] = 0
        return s
    else:
        used[s] += 1
        return f"{s}-{used[s]}"

def strip_md_inline_for_slug(text):
    t = re.sub(r'`([^`]*)`', r'\1', text)
    t = re.sub(r'\*\*([^*]*)\*\*', r'\1', t)
    t = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', t)
    return t.strip()

# ---------- inline formatting ----------
LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
BOLD_RE = re.compile(r'\*\*([^*]+)\*\*')
CODE_RE = re.compile(r'`([^`]+)`')

SEV_WORDS = {
    'critical':'sev-critical','high':'sev-high','medium':'sev-medium','low':'sev-low',
    'info':'sev-info','pass':'sev-pass','fail':'sev-fail','partial':'sev-partial',
    'verified':'sev-pass','unverified':'sev-fail','true':'sev-pass','false':'sev-fail',
    'new':'sev-info','open':'sev-high','fixed':'sev-pass','regressed':'sev-critical',
    'not_reproduced':'sev-medium','false_positive':'sev-info','accepted_risk':'sev-medium',
    'replayable':'sev-pass','match':'sev-pass','possible_match':'sev-medium','new_finding':'sev-info',
    'block':'sev-critical','warn':'sev-high',
}

def inline_md(text, link_map, sec_id):
    parts = []
    i = 0
    tokens = []
    # tokenize by scanning for code spans, bold, links in order of appearance
    pattern = re.compile(r'(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))')
    last = 0
    out = []
    for m in pattern.finditer(text):
        out.append(('text', text[last:m.start()]))
        tok = m.group(0)
        if tok.startswith('`'):
            out.append(('code', tok[1:-1]))
        elif tok.startswith('**'):
            out.append(('bold', tok[2:-2]))
        elif tok.startswith('['):
            lm = LINK_RE.match(tok)
            out.append(('link', lm.group(1), lm.group(2)))
        last = m.end()
    out.append(('text', text[last:]))

    buf = []
    for tok in out:
        if tok[0] == 'text':
            buf.append(html.escape(tok[1]))
        elif tok[0] == 'code':
            inner = tok[1]
            key = inner.strip().strip("'").strip('"').lower()
            cls = SEV_WORDS.get(key)
            esc = html.escape(inner)
            if cls:
                buf.append(f'<code class="badge {cls}"><i></i>{esc}</code>')
            else:
                buf.append(f'<code>{esc}</code>')
        elif tok[0] == 'bold':
            buf.append(f'<strong>{inline_md(tok[1], link_map, sec_id)}</strong>')
        elif tok[0] == 'link':
            label, href = tok[1], tok[2]
            newhref = resolve_link(href, link_map, sec_id)
            target = '' if newhref.startswith('#') else ' target="_blank" rel="noopener"'
            buf.append(f'<a href="{html.escape(newhref)}"{target}>{inline_md(label, link_map, sec_id)}</a>')
    return ''.join(buf)

def resolve_link(href, link_map, sec_id):
    if href.startswith('http://') or href.startswith('https://'):
        return href
    if href.startswith('#'):
        anchor = href[1:]
        return f'#{sec_id}-{anchor}' if anchor else f'#{sec_id}'
    # relative markdown link, possibly with an anchor
    frag = ''
    path = href
    if '#' in href:
        path, frag = href.split('#', 1)
    path = path.replace('%20', ' ')
    target_sec = link_map.get(path)
    if not target_sec:
        # try resolving relative without leading ../ normalisation issues
        norm = os.path.normpath(path)
        target_sec = link_map.get(norm.replace('\\', '/'))
    if target_sec:
        return f'#{target_sec}-{frag}' if frag else f'#{target_sec}'
    return href  # fallback, leave as-is

# ---------- block parser ----------
def parse_blocks(md_text):
    lines = md_text.split('\n')
    blocks = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line.strip() == '':
            i += 1
            continue
        if line.startswith('```'):
            info = line[3:].strip()
            lang = info.split()[0] if info else 'text'
            body = []
            i += 1
            while i < n and not lines[i].startswith('```'):
                body.append(lines[i])
                i += 1
            i += 1
            blocks.append(('code', lang, '\n'.join(body)))
            continue
        if re.match(r'^#{1,4}\s+', line):
            level = len(line) - len(line.lstrip('#'))
            text = line[level:].strip()
            blocks.append(('heading', level, text))
            i += 1
            continue
        if line.strip() == '---':
            blocks.append(('hr',))
            i += 1
            continue
        if line.startswith('>'):
            body = []
            while i < n and (lines[i].startswith('>') or lines[i].strip()==''):
                if lines[i].strip() == '' :
                    if i+1 < n and lines[i+1].startswith('>'):
                        body.append('')
                        i += 1
                        continue
                    else:
                        break
                body.append(lines[i][1:].lstrip() if lines[i].startswith('> ') else lines[i][1:])
                i += 1
            blocks.append(('quote', '\n'.join(body)))
            continue
        if line.startswith('|'):
            tbl = []
            while i < n and lines[i].startswith('|'):
                tbl.append(lines[i])
                i += 1
            blocks.append(('table', tbl))
            continue
        if re.match(r'^\s*[-*]\s+', line):
            items = []
            while i < n and re.match(r'^\s*[-*]\s+', lines[i]):
                items.append(re.sub(r'^\s*[-*]\s+', '', lines[i]))
                i += 1
            blocks.append(('ul', items))
            continue
        if re.match(r'^\s*\d+\.\s+', line):
            items = []
            while i < n and re.match(r'^\s*\d+\.\s+', lines[i]):
                items.append(re.sub(r'^\s*\d+\.\s+', '', lines[i]))
                i += 1
            blocks.append(('ol', items))
            continue
        # paragraph: collect until blank or block-start
        para = [line]
        i += 1
        while i < n and lines[i].strip() != '' and not lines[i].startswith('```') \
              and not re.match(r'^#{1,4}\s+', lines[i]) and lines[i].strip() != '---' \
              and not lines[i].startswith('|') and not lines[i].startswith('>') \
              and not re.match(r'^\s*[-*]\s+', lines[i]) and not re.match(r'^\s*\d+\.\s+', lines[i]):
            para.append(lines[i])
            i += 1
        blocks.append(('p', ' '.join(para)))
    return blocks

def render_table(rows, link_map, sec_id):
    header = [c.strip() for c in rows[0].strip('|').split('|')]
    body_rows = rows[2:]
    out = ['<div class="table-wrap"><table>', '<thead><tr>']
    for h in header:
        out.append(f'<th>{inline_md(h, link_map, sec_id)}</th>')
    out.append('</tr></thead><tbody>')
    for r in body_rows:
        cells = [c.strip() for c in r.strip('|').split('|')]
        out.append('<tr>')
        for c in cells:
            out.append(f'<td>{inline_md(c, link_map, sec_id)}</td>')
        out.append('</tr>')
    out.append('</tbody></table></div>')
    return ''.join(out)

LANG_LABEL = {
    'ts':'TypeScript','typescript':'TypeScript','json':'JSON','yaml':'YAML','yml':'YAML',
    'bash':'Shell','sh':'Shell','text':'','markdown':'Markdown','md':'Markdown',
    'http':'HTTP','diff':'Diff','ts extends':'TypeScript',
}

def render_code(lang, body):
    label = LANG_LABEL.get(lang.lower(), lang.upper() if lang else '')
    tag = f'<span class="lang-tag">{html.escape(label)}</span>' if label else ''
    esc = html.escape(body)
    return f'<div class="code-block">{tag}<pre><code>{esc}</code></pre></div>'

def render_blocks(blocks, link_map, sec_id, used_ids):
    out = []
    for b in blocks:
        kind = b[0]
        if kind == 'heading':
            level, text = b[1], b[2]
            plain = strip_md_inline_for_slug(text)
            slug = gh_slug(plain, used_ids)
            hid = f'{sec_id}-{slug}'
            tag = f'h{min(level,6)}'
            out.append(f'<{tag} id="{hid}"><a class="anchor" href="#{hid}">#</a>{inline_md(text, link_map, sec_id)}</{tag}>')
        elif kind == 'code':
            out.append(render_code(b[1], b[2]))
        elif kind == 'hr':
            out.append('<hr class="rule"/>')
        elif kind == 'quote':
            inner_blocks = parse_blocks(b[1])
            inner_html = render_blocks(inner_blocks, link_map, sec_id, used_ids)
            out.append(f'<blockquote>{inner_html}</blockquote>')
        elif kind == 'table':
            out.append(render_table(b[1], link_map, sec_id))
        elif kind == 'ul':
            items = ''.join(f'<li>{inline_md(it, link_map, sec_id)}</li>' for it in b[1])
            out.append(f'<ul>{items}</ul>')
        elif kind == 'ol':
            items = ''.join(f'<li>{inline_md(it, link_map, sec_id)}</li>' for it in b[1])
            out.append(f'<ol>{items}</ol>')
        elif kind == 'p':
            out.append(f'<p>{inline_md(b[1], link_map, sec_id)}</p>')
    return '\n'.join(out)

# ---------- build link_map: maps relative path (as written in md files) -> section id ----------
def build_link_map():
    link_map = {}
    # from root README.md, links look like: docs/00-overview/README.md , Kase%20MVP...md
    link_map['docs/00-overview/README.md'] = 's00'
    for sid, name, path, _ in SECTIONS:
        if sid.startswith('s'):
            link_map[f'docs/{name}/README.md'] = sid
            link_map[f'../{name}/README.md'] = sid
    link_map['Kase MVP — Product Requirements Document.md'] = 'prd'
    link_map['docs/README.md'] = 'home'
    link_map['docs/20-adr/README.md'] = 's20'
    return link_map

def main():
    link_map = build_link_map()
    results = []
    for sid, name, path, label in SECTIONS:
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        blocks = parse_blocks(text)
        used_ids = {}
        title = name
        if blocks and blocks[0][0] == 'heading' and blocks[0][1] == 1:
            title = inline_md(blocks[0][2], link_map, sid)
            blocks = blocks[1:]
        if sid == 'prd':
            # PRD uses a single '#' for every section header throughout the
            # document body; demote those to the same level the other docs
            # use for their top-level content headings so it doesn't collide
            # with the synthetic per-section title.
            blocks = [(('heading', 2, b[2]) if (b[0] == 'heading' and b[1] == 1) else b) for b in blocks]
        body_html = render_blocks(blocks, link_map, sid, used_ids)
        results.append({'id': sid, 'name': name, 'label': label, 'title': title, 'html': body_html})
        print(f'OK {sid:6s} {name:45s} blocks={len(blocks):4d} html_len={len(body_html):7d}')
    with open(os.path.join(os.path.dirname(__file__), 'sections.json'), 'w', encoding='utf-8') as f:
        json.dump(results, f)
    print('TOTAL html chars:', sum(len(r['html']) for r in results))

if __name__ == '__main__':
    main()
