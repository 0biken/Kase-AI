import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} is missing: ${needle}`);
}

function runVerifier(script, args, marker) {
  const result = spawnSync(process.execPath, [resolve(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 || !output.includes(marker)) {
    throw new Error(`${script} failed its combined verification: ${output.trim()}`);
  }
}

function slugifyHeading(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function verifyLocalLinks(paths) {
  for (const path of paths) {
    const text = read(path);
    const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of text.matchAll(linkPattern)) {
      const raw = match[1].trim();
      if (/^(?:https?:|mailto:)/i.test(raw) || raw.startsWith('#')) continue;
      const [relativePath, anchor] = raw.split('#', 2);
      const decodedPath = decodeURIComponent(relativePath);
      const target = resolve(repoRoot, dirname(path), decodedPath);
      if (!existsSync(target)) throw new Error(`${path} links to missing file: ${raw}`);
      if (!anchor || !target.toLowerCase().endsWith('.md')) continue;
      const headings = readFileSync(target, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^#{1,6}\s+/.test(line))
        .map((line) => slugifyHeading(line.replace(/^#{1,6}\s+/, '')));
      if (!headings.includes(anchor.toLowerCase())) {
        throw new Error(`${path} links to missing heading: ${raw}`);
      }
    }
  }
}

const tasks = read('TASKS.md');
const adr = read('docs/20-adr/README.md');
const roadmap = read('docs/19-roadmap/README.md');
const readme = read('README.md');

const deferredStart = tasks.indexOf('## Deferred — do not start');
const invariantsStart = tasks.indexOf('## Standing invariants');
if (deferredStart < 0 || invariantsStart < deferredStart) throw new Error('TASKS.md section boundaries are missing');
const countedTaskText = `${tasks.slice(0, deferredStart)}${tasks.slice(invariantsStart)}`;
const taskBoxes = [...countedTaskText.matchAll(/^\s*- \[([ x~])\]/gm)];
const doneBoxes = taskBoxes.filter((match) => match[1] === 'x');
if (taskBoxes.length !== 130) throw new Error(`TASKS.md contains ${taskBoxes.length} tasks, expected 130`);
if (doneBoxes.length !== 48) throw new Error(`TASKS.md contains ${doneBoxes.length} completed tasks, expected 48`);

const phase0 = tasks.slice(tasks.indexOf('## Phase 0'), tasks.indexOf('## M1'));
const phase0Boxes = [...phase0.matchAll(/^\s*- \[([ x~])\]/gm)];
if (phase0Boxes.length !== 15 || phase0Boxes.filter((match) => match[1] === 'x').length !== 14) {
  throw new Error('Phase 0 task counts are not 14 of 15');
}

const m2 = tasks.slice(tasks.indexOf('## M2'), tasks.indexOf('## M3'));
const m2Boxes = [...m2.matchAll(/^\s*- \[([ x~])\]/gm)];
if (m2Boxes.length !== 18 || m2Boxes.filter((match) => match[1] === 'x').length !== 18) {
  throw new Error('M2 task counts are not 18 of 18');
}

requireText(adr, '## ADR-015 — Ship Kase rules, never Semgrep Registry rules', 'ADR catalog');
requireText(adr, '## ADR-016 — Bounded retention and mandatory capture-time redaction', 'ADR catalog');
requireText(adr, 'This is a product architecture decision based on published upstream terms, not a substitute for external legal advice.', 'ADR-015 legal boundary');
requireText(roadmap, 'Closed — LGPL engine with notices', 'roadmap licensing closeout');
requireText(roadmap, 'Closed — 90/30/30/30 defaults', 'roadmap retention closeout');
requireText(readme, 'the LLM provider contract is the only remaining Phase 0 item', 'README delivery status');
requireText(roadmap, 'M2 is complete.', 'roadmap M2 closeout');
requireText(readme, 'M1 and M2 are implemented and verified', 'README M2 closeout');

runVerifier('scripts/verify-semgrep-decision.mjs', ['--self-test'], 'SEMGREP_DECISION_VERIFIED');
runVerifier('scripts/verify-semgrep-decision.mjs', ['--contracts'], 'SEMGREP_CONTRACTS_VERIFIED');
runVerifier('scripts/verify-evidence-policy.mjs', ['--retention', '--self-test'], 'EVIDENCE_RETENTION_VERIFIED');
runVerifier('scripts/verify-evidence-policy.mjs', ['--redaction', '--self-test'], 'EVIDENCE_REDACTION_VERIFIED');

verifyLocalLinks([
  'README.md',
  'TASKS.md',
  'docs/02-stack/README.md',
  'docs/03-data-model/README.md',
  'docs/07-tool-adapters/README.md',
  'docs/08-evidence/README.md',
  'docs/14-api/README.md',
  'docs/19-roadmap/README.md',
  'docs/20-adr/README.md',
]);

console.log('PHASE0_DECISIONS_VERIFIED');
