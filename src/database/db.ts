import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

let dbInstance: Database | null = null;
const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'trading_analyst.sqlite');

export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
    initSchema(dbInstance);
    seedInitialData(dbInstance);
    persistDatabase();
  }

  return dbInstance;
}

export function persistDatabase(): void {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Error persisting SQLite database to disk:', err);
  }
}

function initSchema(db: Database) {
  const schemaSQL = `
    -- 1. Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      created_at INTEGER NOT NULL
    );

    -- 2. Markets
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL
    );

    -- 3. Instruments
    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      market_id TEXT NOT NULL,
      tick_size REAL NOT NULL,
      lot_size REAL NOT NULL
    );

    -- 4. Currency Pairs
    CREATE TABLE IF NOT EXISTS currency_pairs (
      symbol TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      pip_size REAL NOT NULL,
      digits INTEGER NOT NULL,
      typical_spread REAL NOT NULL
    );

    -- 5. Underlyings
    CREATE TABLE IF NOT EXISTS underlyings (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      exchange TEXT NOT NULL,
      strike_step REAL NOT NULL,
      lot_size INTEGER NOT NULL,
      tick_size REAL NOT NULL,
      standard_expiry_day TEXT NOT NULL
    );

    -- 6. Contracts
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      underlying TEXT NOT NULL,
      expiry TEXT NOT NULL,
      strike REAL NOT NULL,
      option_type TEXT NOT NULL,
      lot_size INTEGER NOT NULL
    );

    -- 7. Market Data
    CREATE TABLE IF NOT EXISTS market_data (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      price REAL NOT NULL,
      volume REAL,
      data_status TEXT NOT NULL
    );

    -- 8. Candles
    CREATE TABLE IF NOT EXISTS candles (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      oi REAL,
      vwap REAL
    );

    -- 9. Technical Features
    CREATE TABLE IF NOT EXISTS technical_features (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      rsi REAL,
      ema9 REAL,
      ema21 REAL,
      ema50 REAL,
      ema200 REAL,
      atr REAL,
      vwap REAL
    );

    -- 10. Options Chain
    CREATE TABLE IF NOT EXISTS options_chain (
      id TEXT PRIMARY KEY,
      underlying TEXT NOT NULL,
      expiry TEXT NOT NULL,
      spot_price REAL NOT NULL,
      pcr REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 11. Option Contracts
    CREATE TABLE IF NOT EXISTS option_contracts (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL,
      strike REAL NOT NULL,
      option_type TEXT NOT NULL,
      ltp REAL NOT NULL,
      oi REAL NOT NULL,
      change_oi REAL NOT NULL,
      volume REAL NOT NULL,
      iv REAL NOT NULL
    );

    -- 12. Greeks
    CREATE TABLE IF NOT EXISTS greeks (
      contract_id TEXT PRIMARY KEY,
      delta REAL NOT NULL,
      gamma REAL NOT NULL,
      theta REAL NOT NULL,
      vega REAL NOT NULL,
      rho REAL NOT NULL,
      iv REAL NOT NULL,
      model_derived INTEGER NOT NULL
    );

    -- 13. Signals
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      market TEXT NOT NULL,
      instrument TEXT NOT NULL,
      pair TEXT,
      timeframe TEXT,
      underlying TEXT,
      direction TEXT NOT NULL,
      category TEXT NOT NULL,
      strategy TEXT NOT NULL,
      score REAL NOT NULL,
      ml_probability REAL,
      entry_preferred REAL NOT NULL,
      entry_min REAL,
      entry_max REAL,
      stop_loss REAL NOT NULL,
      target1 REAL NOT NULL,
      target2 REAL NOT NULL,
      target3 REAL,
      risk_reward REAL NOT NULL,
      trend TEXT,
      market_regime TEXT,
      session TEXT,
      status TEXT NOT NULL,
      data_status TEXT,
      strategy_version TEXT,
      model_version TEXT NOT NULL
    );

    -- 13b. Paper Signal Tracking
    CREATE TABLE IF NOT EXISTS paper_tracking (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      tp1 REAL NOT NULL,
      tp2 REAL NOT NULL,
      tp3 REAL NOT NULL,
      unrealized_pnl_pips REAL NOT NULL,
      unrealized_pnl_usd REAL NOT NULL,
      status TEXT NOT NULL,
      exit_condition TEXT,
      entry_timestamp INTEGER NOT NULL,
      last_updated_timestamp INTEGER NOT NULL,
      exit_timestamp INTEGER
    );

    -- 14. Signal Events
    CREATE TABLE IF NOT EXISTS signal_events (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      notes TEXT
    );

    -- 15. Trades
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      signal_id TEXT,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      size REAL NOT NULL,
      pnl REAL,
      status TEXT NOT NULL,
      entry_time INTEGER NOT NULL,
      exit_time INTEGER
    );

    -- 16. Positions
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      quantity REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      stop_loss REAL,
      take_profit REAL
    );

    -- 17. Orders
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      order_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      price REAL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 18. Portfolio
    CREATE TABLE IF NOT EXISTS portfolio (
      id TEXT PRIMARY KEY,
      balance REAL NOT NULL,
      equity REAL NOT NULL,
      margin_used REAL NOT NULL,
      free_margin REAL NOT NULL,
      currency TEXT NOT NULL
    );

    -- 19. Economic Events
    CREATE TABLE IF NOT EXISTS economic_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      currency TEXT NOT NULL,
      impact TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      blocks_entry INTEGER NOT NULL
    );

    -- 20. Model Versions
    CREATE TABLE IF NOT EXISTS model_versions (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      trained_at INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    -- 21. Model Predictions
    CREATE TABLE IF NOT EXISTS model_predictions (
      id TEXT PRIMARY KEY,
      model_version_id TEXT NOT NULL,
      instrument TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      predicted_class TEXT NOT NULL,
      probability REAL NOT NULL
    );

    -- 22. Backtest Runs
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      market TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      total_trades INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      profit_factor REAL NOT NULL
    );

    -- 23. Backtest Trades
    CREATE TABLE IF NOT EXISTS backtest_trades (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      instrument TEXT NOT NULL,
      pnl REAL NOT NULL,
      return_pct REAL NOT NULL
    );

    -- 24. Strategy Configs
    CREATE TABLE IF NOT EXISTS strategy_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      min_score REAL NOT NULL,
      min_rr REAL NOT NULL
    );

    -- 25. Broker Accounts
    CREATE TABLE IF NOT EXISTS broker_accounts (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      environment TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL NOT NULL,
      equity REAL NOT NULL,
      available_margin REAL NOT NULL,
      used_margin REAL NOT NULL,
      free_margin REAL NOT NULL,
      currency TEXT NOT NULL,
      connection_status TEXT NOT NULL,
      server TEXT,
      permissions_json TEXT,
      last_update INTEGER NOT NULL,
      is_live_account INTEGER NOT NULL DEFAULT 0,
      UNIQUE(broker, environment, account_id)
    );

    -- 26. Trade Trace Roots
    CREATE TABLE IF NOT EXISTS trade_traces (
      trade_trace_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 27. Trade Trace Lifecycle Nodes
    CREATE TABLE IF NOT EXISTS trade_trace_nodes (
      node_id TEXT PRIMARY KEY,
      trade_trace_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 28. Trade Notes
    CREATE TABLE IF NOT EXISTS trade_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      symbol TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 30. ML Persistence Bridge
    CREATE TABLE IF NOT EXISTS ml_storage_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    -- 29. Risk Configs & System Settings
    CREATE TABLE IF NOT EXISTS risk_configs (
      id TEXT PRIMARY KEY,
      max_risk_per_trade_pct REAL NOT NULL,
      max_daily_loss_pct REAL NOT NULL,
      max_open_positions INTEGER NOT NULL,
      trading_mode TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;

  db.run(schemaSQL);

  // Safe migrations for preexisting DB
  const safeAddColumns = [
    'ALTER TABLE signals ADD COLUMN pair TEXT;',
    'ALTER TABLE signals ADD COLUMN timeframe TEXT;',
    'ALTER TABLE signals ADD COLUMN entry_min REAL;',
    'ALTER TABLE signals ADD COLUMN entry_max REAL;',
    'ALTER TABLE signals ADD COLUMN target3 REAL;',
    'ALTER TABLE signals ADD COLUMN trend TEXT;',
    'ALTER TABLE signals ADD COLUMN market_regime TEXT;',
    'ALTER TABLE signals ADD COLUMN session TEXT;',
    'ALTER TABLE signals ADD COLUMN data_status TEXT;',
    'ALTER TABLE signals ADD COLUMN strategy_version TEXT;'
  ];
  for (const alter of safeAddColumns) {
    try {
      db.run(alter);
    } catch {
      // Column already exists, ignore
    }
  }
}

function seedInitialData(db: Database) {
  // Markets
  db.run(`INSERT OR IGNORE INTO markets (id, code, name, status, currency) VALUES 
    ('mkt_fx', 'FOREX', 'Global Foreign Exchange', 'ACTIVE', 'USD'),
    ('mkt_in_eq', 'INDIA_EQUITY', 'Indian Equity Benchmark Indices', 'ACTIVE', 'INR'),
    ('mkt_in_opt', 'INDIA_OPTIONS', 'Indian Equity Index Options', 'ACTIVE', 'INR');
  `);

  // System settings
  const now = Date.now();
  db.run(`INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES 
    ('TRADING_MODE', 'LIVE_ONLY', ${now}),
    ('DATA_STATUS', 'UNAVAILABLE', ${now}),
    ('MODEL_STATUS', 'BASELINE_UNCALIBRATED', ${now}),
    ('DEFAULT_RISK_PCT', '1.0', ${now}),
    ('STRIKE_DEPTH', '7', ${now});
  `);

  // Enforce LIVE_ONLY persistence and remove obsolete PAPER/DEMO defaults.
  db.run(`UPDATE system_settings SET value = 'LIVE_ONLY', updated_at = ${now} WHERE key = 'TRADING_MODE';
    UPDATE system_settings SET value = 'UNAVAILABLE', updated_at = ${now} WHERE key = 'DATA_STATUS';
    UPDATE risk_configs SET trading_mode = 'LIVE_ONLY';
  `);

  // Risk configs
  db.run(`INSERT OR IGNORE INTO risk_configs (id, max_risk_per_trade_pct, max_daily_loss_pct, max_open_positions, trading_mode) VALUES 
    ('default_risk', 1.0, 3.0, 5, 'LIVE_ONLY');
  `);

  // Portfolio
  db.run(`INSERT OR IGNORE INTO portfolio (id, balance, equity, margin_used, free_margin, currency) VALUES 
    ('paper_account', 100000.00, 100000.00, 0.0, 100000.00, 'USD');
  `);

  // Economic events
  db.run(`INSERT OR IGNORE INTO economic_events (id, title, currency, impact, timestamp, blocks_entry) VALUES 
    ('ev_1', 'FOMC Rate Decision & Press Conference', 'USD', 'HIGH', ${now + 7200000}, 0),
    ('ev_2', 'ECB Monetary Policy Statement', 'EUR', 'HIGH', ${now + 14400000}, 0),
    ('ev_3', 'RBI Monetary Policy Committee Outcome', 'INR', 'HIGH', ${now + 28800000}, 0),
    ('ev_4', 'US Core CPI Inflation (YoY)', 'USD', 'HIGH', ${now + 50000000}, 0);
  `);
}

export async function executeQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDatabase();
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export async function executeRun(sql: string, params: any[] = []): Promise<void> {
  const db = await getDatabase();
  db.run(sql, params);
  persistDatabase();
}

export async function getDatabaseStats() {
  const db = await getDatabase();
  const tables = [
    'markets', 'currency_pairs', 'underlyings', 'contracts', 'candles',
    'signals', 'trades', 'positions', 'orders', 'portfolio', 'economic_events',
    'risk_configs', 'system_settings'
  ];

  const stats: Record<string, number> = {};
  for (const table of tables) {
    try {
      const res = db.exec(`SELECT count(*) as count FROM ${table}`);
      const count = (res[0]?.values[0]?.[0] as number) ?? 0;
      stats[table] = count;
    } catch {
      stats[table] = 0;
    }
  }

  return stats;
}
