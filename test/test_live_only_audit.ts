import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const FORBIDDEN = [
  /\bPAPER\b/g,
  /\bDEMO\b/g,
  /\bSANDBOX\b/g,
  /paper_account/gi,
  /paper_tracking/gi,
  /PaperBroker/gi,
  /DemoAdapter/gi,
  /demoExecution/gi,
  /generateDemo/gi,
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
  `LIVE_ONLY audit failed. Forbidden paper/demo/sandbox/synthetic runtime references remain:\n${findings.join('\n')}`
);

console.log('LIVE-ONLY SOURCE AUDIT PASSED');
