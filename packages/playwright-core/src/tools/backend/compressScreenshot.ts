import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const SHOTS_DIR_NAME = '.screenshots';
const MAX_WIDTH = 1600;

function findRepoRoot(from: string): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: from,
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
  } catch { /* fall through */ }

  let dir = from;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.git')))
      return path.resolve(dir);
    const parent = path.dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  return process.cwd();
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

let sharpModule: any;
function loadSharp(): any {
  if (sharpModule)
    return sharpModule;
  sharpModule = require('sharp');
  if (!sharpModule)
    throw new Error('sharp not found');
  return sharpModule;
}

export interface CompressOptions {
  /** Defaults to repo-root/.screenshots */
  outputDir?: string;
}

export async function compressScreenshot(srcPath: string, options?: CompressOptions): Promise<string | null> {
  if (!fs.existsSync(srcPath)) {
    console.error(`[compress] not found: ${srcPath}`);
    return null;
  }
  const beforeStat = fs.statSync(srcPath);
  if (beforeStat.size === 0) {
    console.error(`[compress] ${path.basename(srcPath)}: empty, skip`);
    return null;
  }

  const repoRoot = findRepoRoot(path.dirname(srcPath));
  const shotsDir = options?.outputDir ?? path.join(repoRoot, SHOTS_DIR_NAME);
  const destPath = path.join(shotsDir, path.basename(srcPath));

  let finalDest = destPath;
  if (fs.existsSync(finalDest) && path.resolve(srcPath) !== path.resolve(finalDest)) {
    const ts = Date.now();
    const ext = path.extname(finalDest);
    const stem = path.basename(finalDest, ext);
    finalDest = path.join(shotsDir, `${stem}-${ts}${ext}`);
  }

  try {
    const sharp = loadSharp();
    const buf = await sharp(srcPath, { failOn: 'none' })
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true, quality: 80, effort: 10 })
      .toBuffer();

    ensureDir(path.dirname(finalDest));
    fs.writeFileSync(finalDest, buf);

    const afterStat = fs.statSync(finalDest);
    const ratio = ((1 - afterStat.size / beforeStat.size) * 100).toFixed(1);
    const sign = ratio.startsWith('-') ? '+' : '-';
    console.log(
      `[compress] ${path.basename(srcPath)} → ${path.relative(repoRoot, finalDest)}: ${formatBytes(beforeStat.size)} → ${formatBytes(afterStat.size)} (${sign}${Math.abs(parseFloat(ratio))}%)`
    );

    if (path.resolve(srcPath) !== path.resolve(finalDest)) {
      try { fs.unlinkSync(srcPath); } catch { /* best effort */ }
    }

    return finalDest;
  } catch (err: any) {
    console.error(`[compress] failed for ${srcPath}: ${err.message}`);
    return null;
  }
}
