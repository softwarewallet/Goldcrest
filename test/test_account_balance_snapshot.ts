import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { brokerRegistry } from '../src/brokers/registry';
import { captureAccountBalanceSnapshots, getAccountBalanceSnapshots } from '../src/services/accountBalanceSnapshotService';

const capturedAt = Date.now();
const fakeAccount = {
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
};

const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
const original = adapter.getAccount;
(adapter as any).getAccount = async () => fakeAccount;

try {
  const rows = await captureAccountBalanceSnapshots(capturedAt);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].broker, 'CTRADER');
  assert.equal(rows[0].balance, 10000);
  assert.equal(rows[0].equity, 10125);

  await executeRun(
    `INSERT OR REPLACE INTO account_balance_snapshots
     (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['obsolete-broker-fixture', 'CTRADER', 'LIVE', 'TEST-OBSOLETE', 'USD', capturedAt, 1, 1, 0, 1, 'CAPTURED', null]
  );

  const stored = await getAccountBalanceSnapshots({ from: capturedAt, to: capturedAt, limit: 10 });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].broker, 'CTRADER');
  assert.equal(stored[0].balance, 10000);

  const legacy = await getAccountBalanceSnapshots({ from: capturedAt, to: capturedAt, broker: 'CTRADER', limit: 10 });
  assert.equal(legacy.every(row => row.broker === 'CTRADER'), true);
} finally {
  (adapter as any).getAccount = original;
  await executeRun('DELETE FROM account_balance_snapshots WHERE captured_at >= ? AND captured_at <= ?', [capturedAt - 1, capturedAt + 1]);
}
console.log('ACCOUNT BALANCE SNAPSHOT TESTS PASSED');
