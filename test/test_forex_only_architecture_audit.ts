import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { brokerRegistry } from '../src/brokers/registry';
import { getSystemConfig } from '../src/services/configService';

const forbidden = [
  /5paisa/i,
  /FIVE_PAISA/i,
  /getFivePaisaAdapter/i,
  /INDIAN_EQUITY/i,
  /INDIAN_FUTURES/i,
  /INDIAN_OPTIONS/i,
  /INDIAN_/i,
  /getIndianSessionState/i,
  /maxTradeValueIndianInr/i,
  /BANKNIFTY/i,
  /FINNIFTY/i,
  /MIDCPNIFTY/i,
  /SENSEX/i,
  /\bIndian\b/i,
  /\bIndia\b/i
];

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const srcRoot = path.resolve(process.cwd(), 'src');
const sourceFiles = walk(srcRoot);
const sourceViolations: string[] = [];

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      sourceViolations.push(path.relative(process.cwd(), file) + ' :: ' + pattern.toString());
    }
  }
}

assert.deepEqual(sourceViolations, [], 'Forex-only source audit found forbidden Indian-market/5paisa references.');

const activeLiveAdapters = brokerRegistry.getActiveLiveAdapters();
assert.equal(activeLiveAdapters.length, 1);
assert.equal(activeLiveAdapters[0].broker, 'CTRADER');
assert.equal(activeLiveAdapters[0].environment, 'LIVE');
assert.equal(activeLiveAdapters[0].isLive, true);
assert.equal(brokerRegistry.getAdapterForMarket('FOREX').broker, 'CTRADER');

assert.throws(
  () => brokerRegistry.getAdapterForMarket('INDIAN_EQUITY'),
  /FOREX only|not supported/i
);

const credentialStatuses = brokerRegistry.getCredentialStatuses();
assert.deepEqual(
  credentialStatuses.map(item => item.broker),
  ['CTRADER']
);

const config = getSystemConfig() as Record<string, unknown>;
assert.equal(Object.prototype.hasOwnProperty.call(config, 'maxTradeValueIndianInr'), false);
assert.equal(config.tradingMode, 'LIVE_ONLY');

console.log('FOREX-ONLY ARCHITECTURE AUDIT: PASSED');
console.log('Active broker: cTrader only');
console.log('Active market: FOREX only');
