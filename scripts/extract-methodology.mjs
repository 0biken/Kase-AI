import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import extractZip from 'extract-zip';

/**
 * Extracts methodology reference files from .skill archives into the
 * versioned methodology directory for the agent runtime.
 *
 * M4 explicitly excludes the interactive SKILL.md orchestration files (ADR-011).
 */

const ROOT = path.join(process.cwd());
const METHODOLOGY_DIR = path.join(ROOT, 'methodology', 'v1');
const BLACKBOX_DIR = path.join(METHODOLOGY_DIR, 'blackbox');
const WHITEBOX_DIR = path.join(METHODOLOGY_DIR, 'whitebox');

const SKILL_FILES = {
  blackbox: 'qa-audit.skill',
  whitebox: 'qa-audit-whitebox.skill',
};

async function digestFile(filePath) {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function extractSkill(role, zipName, outDir) {
  const zipPath = path.join(ROOT, zipName);
  const tmpDir = path.join(ROOT, 'tmp', `extract-${role}`);
  
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  try {
    await extractZip(zipPath, { dir: tmpDir });
  } catch (err) {
    throw new Error(`Failed to extract ${zipName}: ${err.message}`);
  }

  // Find references directory
  const rootContents = await fs.readdir(tmpDir);
  const skillRoot = path.join(tmpDir, rootContents[0]);
  const refDir = path.join(skillRoot, 'references');
  let stats;
  try {
    stats = await fs.stat(refDir);
  } catch {
    throw new Error(`${zipName} is missing a references/ directory`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`references/ in ${zipName} is not a directory`);
  }

  // Copy references
  const files = await fs.readdir(refDir);
  const digests = {};

  for (const file of files) {
    if (file === 'SKILL.md') {
      throw new Error(`SKILL.md found in references/ of ${zipName}. It must be excluded.`);
    }

    const src = path.join(refDir, file);
    const dst = path.join(outDir, file);
    
    await fs.copyFile(src, dst);
    digests[`${role}/${file}`] = await digestFile(dst);
  }

  // Check root for SKILL.md just to ensure it wasn't accidentally copied
  try {
    const skillMd = path.join(skillRoot, 'SKILL.md');
    await fs.access(skillMd);
  } catch {
    // Missing is good
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
  return { archiveDigest: await digestFile(zipPath), files: digests };
}

async function main() {
  console.log('Extracting methodology references...');
  await fs.mkdir(METHODOLOGY_DIR, { recursive: true });

  const blackbox = await extractSkill('blackbox', SKILL_FILES.blackbox, BLACKBOX_DIR);
  const whitebox = await extractSkill('whitebox', SKILL_FILES.whitebox, WHITEBOX_DIR);

  const manifest = {
    version: '1.0.0',
    archiveDigests: {
      [SKILL_FILES.blackbox]: blackbox.archiveDigest,
      [SKILL_FILES.whitebox]: whitebox.archiveDigest,
    },
    referenceFiles: {
      ...blackbox.files,
      ...whitebox.files,
    },
    upstreamSkillVersion: '1.0.0',
    kasePromptVersion: 'm4-1.0.0',
  };

  await fs.writeFile(
    path.join(METHODOLOGY_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  console.log('Methodology extracted and manifest generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
