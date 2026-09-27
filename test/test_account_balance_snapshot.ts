import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { brokerRegistry } from '../src/brokers/registry';
import { captureAccountBalanceSnapshots, getAccountBalanceSnapshots } from '../src/services/accountBalanceSnapshotService';

const capturedAt = Date.now();
const fakeAccounts: Record<string, any> = {
  CTRADER: {
    accountId: 'TEST-CTRADER',
    accountType: 'LIVE',
    balance: 10000,
    equity: 10125,
    availableMargin: 8125,
    usedMargin: 2000,
    freeMargin: 8125,
    currency: 'USD',
    broker: 'CTRADER',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: capturedAt
  },
  FIVE_PAISA: {
    accountId: 'TEST-5PAISA',
    accountType: 'LIVE',
    balance: 250000,
    equity: 251500,
    availableMargin: 201500,
    usedMargin: 50000,
    freeMargin: 201500,
    currency: 'INR',
    broker: 'FIVE_PAISA',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    lastUpdate: capturedAt
  }
};

for (const broker of ['CTRADER', 'FIVE_PAISA'] as const) {
  brokerRegistry.registerAdapter(broker, 'LIVE', {
    getAccount: async () => fakeAccounts[broker]
  } as any);
}

const rows = await captureAccountBalanceSnapshots(capturedAt);
assert.equal(rows.length, 2);
assert.equal(rows.every(row => row.status === 'CAPTURED'), true);

const stored = await getAccountBalanceSnapshots({ from: capturedAt, to: capturedAt, limit: 10 });
assert.equal(stored.length, 2);

const ctrader = stored.find(row => row.broker === 'CTRADER');
assert.equal(ctrader?.balance, 10000);
assert.equal(ctrader?.equity, 10125);
assert.equal(ctrader?.usedMargin, 2000);
assert.equal(ctrader?.freeMargin, 8125);
assert.equal(ctrader?.currency, 'USD');

const fivePaisa = stored.find(row => row.broker === 'FIVE_PAISA');
assert.equal(fivePaisa?.balance, 250000);
assert.equal(fivePaisa?.equity, 251500);
assert.equal(fivePaisa?.usedMargin, 50000);
assert.equal(fivePaisa?.freeMargin, 201500);
assert.equal(fivePaisa?.currency, 'INR');

await executeRun('DELETE FROM account_balance_snapshots WHERE captured_at = ?', [capturedAt]);

console.log('ACCOUNT BALANCE SNAPSHOT TESTS PASSED');
