import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const FORBIDDEN = [
  /\bpaper\b/gi,
  /\bsandbox\b/gi,
  /paper_[a-z0-9_]+/gi,
  /paper[A-Z][A-Za-z0-9_]*/g,
  /Paper[A-Z][A-Za-z0-9_]*/g,
  /sandbox_[a-z0-9_]+/gi,
  /sandbox[A-Z][A-Za-z0-9_]*/g,
  /synthetic/gi,
  /simulated capital/gi,
  /PAPER_SIMULATION/gi
];

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) results.push(full);
  }
  return results;
}

const findings: string[] = [];
for (const file of walk(SRC_DIR)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of FORBIDDEN) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`);
        break;
      }
    }
  });
}

assert.equal(
  findings.length,
  0,
  `LIVE runtime audit failed. Forbidden paper/sandbox/synthetic runtime references remain:\n${findings.join('\n')}`
);

console.log('LIVE-ONLY SOURCE AUDIT PASSED');
