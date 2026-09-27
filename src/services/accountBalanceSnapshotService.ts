import { executeQuery, executeRun } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import type { BrokerAccountInfo, BrokerType } from '../brokers/types';

export interface AccountBalanceSnapshot {
  id: string;
  broker: BrokerType;
  environment: 'LIVE';
  accountId: string;
  currency: string;
  capturedAt: number;
  balance: number | null;
  equity: number | null;
  usedMargin: number | null;
  freeMargin: number | null;
  status: 'CAPTURED' | 'ERROR';
  errorMessage?: string;
}

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerStarted = false;

async function ensureTable(): Promise<void> {
  await executeRun(`
    CREATE TABLE IF NOT EXISTS account_balance_snapshots (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      balance REAL,
      equity REAL,
      used_margin REAL,
      free_margin REAL,
      status TEXT NOT NULL,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_account_balance_snapshots_captured_at
      ON account_balance_snapshots(captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_balance_snapshots_broker_time
      ON account_balance_snapshots(broker, captured_at DESC);
  `);
}

function snapshotId(broker: BrokerType, capturedAt: number): string {
  return `BALANCE-SNAPSHOT-${broker}-${capturedAt}`;
}

function nextThreeHourBoundary(now = new Date()): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  const currentHour = next.getHours();
  const nextHour = currentHour - (currentHour % 3) + 3;
  next.setHours(nextHour);
  return next;
}

async function captureBrokerBalance(broker: BrokerType, capturedAt: number): Promise<AccountBalanceSnapshot> {
  try {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    const account: BrokerAccountInfo = await adapter.getAccount();

    const balance = Number(account.balance);
    const equity = Number(account.equity);
    const usedMargin = Number(account.usedMargin);
    const freeMargin = Number(account.freeMargin);

    if (![balance, equity, usedMargin, freeMargin].every(Number.isFinite)) {
      throw new Error('BROKER_ACCOUNT_BALANCE_FIELDS_INVALID');
    }

    const snapshot: AccountBalanceSnapshot = {
      id: snapshotId(broker, capturedAt),
      broker,
      environment: 'LIVE',
      accountId: String(account.accountId || '****'),
      currency: String(account.currency || ''),
      capturedAt,
      balance,
      equity,
      usedMargin,
      freeMargin,
      status: 'CAPTURED'
    };

    await executeRun(
      `INSERT OR REPLACE INTO account_balance_snapshots
       (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.broker,
        snapshot.environment,
        snapshot.accountId,
        snapshot.currency,
        snapshot.capturedAt,
        snapshot.balance,
        snapshot.equity,
        snapshot.usedMargin,
        snapshot.freeMargin,
        snapshot.status,
        null
      ]
    );

    return snapshot;
  } catch (err: any) {
    const message = err?.message || String(err);
    const snapshot: AccountBalanceSnapshot = {
      id: snapshotId(broker, capturedAt),
      broker,
      environment: 'LIVE',
      accountId: '****',
      currency: '',
      capturedAt,
      balance: null,
      equity: null,
      usedMargin: null,
      freeMargin: null,
      status: 'ERROR',
      errorMessage: message
    };

    await executeRun(
      `INSERT OR REPLACE INTO account_balance_snapshots
       (id, broker, environment, account_id, currency, captured_at, balance, equity, used_margin, free_margin, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.broker,
        snapshot.environment,
        snapshot.accountId,
        snapshot.currency,
        snapshot.capturedAt,
        null,
        null,
        null,
        null,
        snapshot.status,
        snapshot.errorMessage
      ]
    );

    console.warn(`[Goldcrest] account balance snapshot failed for ${broker}: ${message}`);
    return snapshot;
  }
}

export async function captureAccountBalanceSnapshots(capturedAt = Date.now()): Promise<AccountBalanceSnapshot[]> {
  await ensureTable();
  const timestamp = Number(capturedAt);
  return Promise.all([
    captureBrokerBalance('CTRADER', timestamp),
    captureBrokerBalance('FIVE_PAISA', timestamp)
  ]);
}

export async function getAccountBalanceSnapshots(options: {
  from?: number;
  to?: number;
  broker?: BrokerType;
  limit?: number;
} = {}): Promise<AccountBalanceSnapshot[]> {
  await ensureTable();
  const clauses: string[] = [];
  const params: any[] = [];

  if (Number.isFinite(options.from)) {
    clauses.push('captured_at >= ?');
    params.push(Number(options.from));
  }
  if (Number.isFinite(options.to)) {
    clauses.push('captured_at <= ?');
    params.push(Number(options.to));
  }
  if (options.broker) {
    clauses.push('broker = ?');
    params.push(options.broker);
  }

  const limit = Math.min(Math.max(Math.floor(Number(options.limit || 500)), 1), 5000);
  params.push(limit);

  const rows = await executeQuery<any>(
    `SELECT id, broker, environment, account_id, currency, captured_at, balance, equity,
            used_margin, free_margin, status, error_message
       FROM account_balance_snapshots
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY captured_at DESC, broker ASC
      LIMIT ?`,
    params
  );

  return rows.map(row => ({
    id: String(row.id),
    broker: String(row.broker) as BrokerType,
    environment: 'LIVE' as const,
    accountId: String(row.account_id || '****'),
    currency: String(row.currency || ''),
    capturedAt: Number(row.captured_at),
    balance: row.balance === null || row.balance === undefined ? null : Number(row.balance),
    equity: row.equity === null || row.equity === undefined ? null : Number(row.equity),
    usedMargin: row.used_margin === null || row.used_margin === undefined ? null : Number(row.used_margin),
    freeMargin: row.free_margin === null || row.free_margin === undefined ? null : Number(row.free_margin),
    status: String(row.status) as 'CAPTURED' | 'ERROR',
    errorMessage: row.error_message ? String(row.error_message) : undefined
  }));
}

function scheduleNextBoundary(): void {
  if (!schedulerStarted) return;
  const delay = Math.max(1000, nextThreeHourBoundary().getTime() - Date.now());
  schedulerTimer = setTimeout(async () => {
    try {
      await captureAccountBalanceSnapshots(Date.now());
    } catch (err: any) {
      console.warn('[Goldcrest] 3-hour account balance snapshot cycle failed:', err?.message || err);
    } finally {
      scheduleNextBoundary();
    }
  }, delay);
  schedulerTimer.unref?.();
}

export function startAccountBalanceSnapshotScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  void ensureTable()
    .then(() => scheduleNextBoundary())
    .catch((err) => {
      console.warn('[Goldcrest] account balance snapshot scheduler initialization failed:', err?.message || err);
      scheduleNextBoundary();
    });
}

export function stopAccountBalanceSnapshotScheduler(): void {
  schedulerStarted = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
