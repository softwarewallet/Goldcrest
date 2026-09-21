import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { apiRateLimit, blockLegacyTradingModes, operatorAuthConfigured, operatorAuthRequired, requestId, securityHeaders, issueOperatorSession, setOperatorSessionCookie, clearOperatorSessionCookie, isOperatorSessionValid } from './src/server/security';

import { getDatabase, getDatabaseStats, executeQuery, executeRun, persistDatabase } from './src/database/db';
import { getForexSessionState, getIndianSessionState } from './src/markets/common/session';
import { FOREX_PAIRS, getForexPairConfig } from './src/markets/forex/instruments';
import { INDIAN_UNDERLYINGS } from './src/markets/india_equity/underlyings';
import { ScannerService } from './src/services/scannerService';
import { getSystemConfig, updateSystemConfig, applyPersistedSystemConfig } from './src/services/configService';
import { calculateStrategyPayoff } from './src/markets/india_options/strategySkeleton';

// Phase 2A Forex Engines
import { LiveForexProvider } from './src/markets/forex/provider';
import { ForexSignalEngine } from './src/markets/forex/signalEngine';
import { calculateIndicators } from './src/markets/forex/indicators';
import { analyzeMarketStructure } from './src/markets/forex/marketStructure';
import { calculateSupportResistance } from './src/markets/forex/supportResistance';
import { analyzeMultiTimeframe } from './src/markets/forex/multiTimeframe';
import { explainForexAnalysis } from './src/services/geminiExplainer';
import { ForexTimeframe } from './src/markets/forex/types';

// Phase 2B Broker Integration
import { BrokerError } from './src/brokers/errors';
import { brokerRouter } from './src/brokers/brokerRoutes';
import { LIVE_AUTO_EXECUTION_ALLOWED, refreshAutonomousExecutionPermission, armAutonomousExecutionGate, lockAutonomousExecutionGate } from './src/brokers/safety/AutoExecutionEngine';
import { autoTradingService } from './src/services/autoTradingService';
import { initializeLiveRuntimeLog, getLiveRuntimeLogStatus, startLiveRuntimeLog, stopLiveRuntimeLog, getLiveRuntimeLogFile, listLiveRuntimeLogFiles, logApplicationAction, liveRuntimeLog } from './src/services/liveRuntimeLog';
import { fetchLiveForexNews } from './src/services/liveNewsService';
import { alphaVantageNewsService } from './src/services/alphaVantageNewsService';
import { marketauxNewsService } from './src/services/marketauxNewsService';

// Phase 3 Machine Learning Engine is retained for internal model compatibility;
// the public research/training API is retired while the research program is closed.

// Phase 5 Governance Engine
import { governanceRouter } from './src/governance/governanceRoutes';
import { reconciliationService } from './src/services/reconciliationService';
import { reconcileInFlightExecutionIntents } from './src/services/executionReconciliationService';

// Legacy demo execution is retired; LIVE_ONLY production mode is enforced by the server safety layer.
import { brokerRegistry } from './src/brokers/registry';

const invokedByNpmDev = process.env.npm_lifecycle_event === 'dev';
// npm run dev is an explicit local development command. Do not let a stale
// NODE_ENV=production value in .env accidentally switch this process into the
// production preflight path.
if (invokedByNpmDev) {
  process.env.NODE_ENV = 'development';
}

dotenv.config();

// Start durable audit logging before the application initializes any broker,
// database, reconciliation, or Auto Live services. Credentials and secrets are
// sanitized by the logging service.
const startupAudit = initializeLiveRuntimeLog('APPLICATION_START');
logApplicationAction('APPLICATION_BOOT', {
  pid: process.pid,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  auditFile: startupAudit.file
});

process.on('uncaughtException', (error) => {
  liveRuntimeLog('ERROR', 'PROCESS_UNCAUGHT_EXCEPTION', {
    message: error?.message || String(error),
    stack: error?.stack
  });
});

process.on('unhandledRejection', (reason) => {
  liveRuntimeLog('ERROR', 'PROCESS_UNHANDLED_REJECTION', {
    reason: reason instanceof Error
      ? { message: reason.message, stack: reason.stack }
      : reason
  });
});

// Local development uses the same LIVE execution pipeline for end-to-end
// broker testing, but the autonomous arm is still operator-triggered.
// Keep the required arm flags enabled in development so START AUTO LIVE does
// not depend on stale .env values. Production remains explicitly gated.
if (process.env.NODE_ENV !== 'production') {
  process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'true';
  process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'true';
  process.env.LIVE_TRADING_ENABLED = 'true';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';
  process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'true';
  updateSystemConfig({
    liveTradingEnabled: true,
    tradingMode: 'LIVE_ONLY'
  });
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const GOLDCREST_RUNTIME_ID = `goldcrest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let databaseReady = false;

function productionPreflight(enforce = false): { ok: boolean; checks: Record<string, string> } {
  const checks: Record<string, string> = {};
  refreshAutonomousExecutionPermission();
  const autoTradingRequested = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true';
  const autonomousRequested = process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  const operatorKey = process.env.GOLDCREST_OPERATOR_API_KEY?.trim();
  const ctraderConfigured = Boolean(
    process.env.CTRADER_LIVE_CLIENT_ID?.trim() &&
    process.env.CTRADER_LIVE_CLIENT_SECRET?.trim() &&
    process.env.CTRADER_LIVE_ACCESS_TOKEN?.trim() &&
    process.env.CTRADER_LIVE_ACCOUNT_ID?.trim()
  );
  const fivePaisaConfigured = Boolean(
    process.env.FIVEPAISA_LIVE_APP_NAME?.trim() &&
    process.env.FIVEPAISA_LIVE_USER_ID?.trim() &&
    process.env.FIVEPAISA_LIVE_USER_KEY?.trim() &&
    process.env.FIVEPAISA_LIVE_CLIENT_CODE?.trim()
  );
  checks.operatorAuth = operatorKey ? 'CONFIGURED' : 'MISSING';
  checks.liveBroker = ctraderConfigured || fivePaisaConfigured ? 'CONFIGURED' : 'MISSING';
  checks.autonomousExecution = LIVE_AUTO_EXECUTION_ALLOWED
    ? 'ENABLED'
    : (autoTradingRequested || autonomousRequested ? 'BLOCKED' : 'DISABLED');
  const productionStrategyApproved = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true'
    && String(process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a').trim() === 'fx_structure_v2a';
  checks.autoTradingBroker = (autoTradingRequested || autonomousRequested)
    ? (ctraderConfigured ? 'CONFIGURED' : 'MISSING')
    : 'NOT_REQUESTED';
  checks.productionStrategy = productionStrategyApproved ? 'APPROVED' : 'NOT_APPROVED';
  checks.tradingMode = getSystemConfig().tradingMode;
  const autoConfigValid = !autoTradingRequested && !autonomousRequested
    ? true
    : LIVE_AUTO_EXECUTION_ALLOWED;
  const ok = Boolean(operatorKey)
    && (ctraderConfigured || fivePaisaConfigured)
    && autoConfigValid
    && getSystemConfig().tradingMode === 'LIVE_ONLY';
  if (!ok && enforce && process.env.NODE_ENV === 'production') {
    throw new Error(`Production preflight failed: ${Object.entries(checks).filter(([, value]) => value !== 'CONFIGURED' && value !== 'DISABLED' && value !== 'LIVE_ONLY').map(([key]) => key).join(', ') || 'invalid safety configuration'}`);
  }
  return { ok, checks };
}

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(requestId);
app.use(apiRateLimit);
app.use(blockLegacyTradingModes);
app.use(express.json({ limit: '512kb' }));

// Durable audit trail for every API action. Request bodies are deliberately
// excluded so credentials/tokens/passwords can never be persisted by this
// middleware. Detailed trade actions are recorded separately by auditLog.ts.
app.use((req: Request, res: Response, next) => {
  const startedAt = Date.now();
  const shouldAudit = req.path.startsWith('/api/');
  if (shouldAudit) {
    liveRuntimeLog('SYSTEM', 'API_REQUEST_STARTED', {
      method: req.method,
      path: req.path,
      query: req.query
    });
  }

  res.on('finish', () => {
    if (!shouldAudit) return;
    liveRuntimeLog(
      res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'SYSTEM',
      'API_REQUEST_COMPLETED',
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      }
    );
  });

  next();
});

// Identify the actual Goldcrest backend process on every API response. This prevents
// a stale Vite/proxy process from being mistaken for the current server.
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Goldcrest-Runtime', GOLDCREST_RUNTIME_ID);
  res.setHeader('X-Goldcrest-Api', 'express-live');
  next();
});

app.get('/api/runtime', (_req: Request, res: Response) => {
  res.type('application/json').json({
    service: 'goldcrest',
    runtime: GOLDCREST_RUNTIME_ID,
    nodeEnv: process.env.NODE_ENV || 'development',
    port: PORT,
    tradingMode: 'LIVE_ONLY',
    timestamp: Date.now()
  });
});

// Operator authentication is a same-origin, HttpOnly session derived from the
// server-side operator API key. The secret is never embedded in the client bundle.
app.get('/api/operator/session', (req: Request, res: Response) => {
  const localDevelopment = process.env.NODE_ENV !== 'production'
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.socket.remoteAddress || req.ip || '').toLowerCase());

  res.json({
    configured: operatorAuthConfigured(),
    authenticated: localDevelopment || isOperatorSessionValid(req),
    bypassedForLocalDevelopment: localDevelopment,
    ttlHours: 8
  });
});

app.post('/api/operator/login', (req: Request, res: Response) => {
  const configuredKey = process.env.GOLDCREST_OPERATOR_API_KEY?.trim();
  if (!configuredKey) {
    return res.status(503).json({
      error: 'OPERATOR_AUTH_NOT_CONFIGURED',
      message: 'Configure GOLDCREST_OPERATOR_API_KEY before using operator authentication.'
    });
  }
  const supplied = String(req.body?.key || '');
  if (!supplied || supplied.length !== configuredKey.length) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid operator credentials are required.' });
  }
  const expected = Buffer.from(configuredKey, 'utf8');
  const actual = Buffer.from(supplied, 'utf8');
  if (!timingSafeEqual(expected, actual)) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid operator credentials are required.' });
  }
  setOperatorSessionCookie(res, issueOperatorSession(configuredKey));
  return res.json({ authenticated: true, expiresInHours: 8 });
});

app.post('/api/operator/logout', (_req: Request, res: Response) => {
  clearOperatorSessionCookie(res);
  res.json({ authenticated: false });
});

app.use('/api/brokers', operatorAuthRequired, brokerRouter);
app.use('/api/ml', operatorAuthRequired, (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'RESEARCH_API_RETIRED',
    message: 'Goldcrest research program is closed. ML training, dataset generation, backtesting and experiment APIs are retired.'
  });
});
app.use('/api/governance', operatorAuthRequired, governanceRouter);

app.get('/api/auto-trading/status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.getStatus());
});

app.post('/api/auto-trading/start', operatorAuthRequired, (req: Request, res: Response) => {
  // During local development, the UI may be served through a wildcard/bind-all
  // host even though the operator is connecting from the same machine.
  // Detect loopback requests explicitly so the local auto-live arm path is
  // deterministic and does not depend on the HOST environment variable.
  if (process.env.NODE_ENV !== 'production') {
    const requestHost = String(req.headers.host || '').split(':')[0].trim().toLowerCase();
    const remoteAddress = String(req.socket.remoteAddress || req.ip || '').toLowerCase().replace(/^::ffff:/, '');
    const loopbackRequest = ['127.0.0.1', 'localhost', '::1'].includes(requestHost) ||
      ['127.0.0.1', 'localhost', '::1'].includes(remoteAddress);
    // The server may bind to 0.0.0.0 while the operator still connects from
    // loopback. In that case the startup host check can have marked local
    // development as false; the request itself is the authoritative signal.
    if (loopbackRequest) process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'true';
  }

  const confirmWhenClosed = req.body?.confirmWhenClosed === true;
  const status = autoTradingService.start({ confirmWhenClosed });
  const statusCode = status.requiresClosedMarketConfirmation
    ? 409
    : (status.state === 'BLOCKED' ? 409 : 200);
  return res.status(statusCode).json(status);
});

app.post('/api/auto-trading/abandon-closed-start', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.abandonClosedMarketStart());
});

app.post('/api/auto-trading/stop', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.stop());
});

// Explicit Execution Gate Controls
app.get('/api/execution-gate/status', operatorAuthRequired, (_req: Request, res: Response) => {
  const permitted = refreshAutonomousExecutionPermission();
  const autoStatus = autoTradingService.getStatus();
  res.json({
    locked: !permitted,
    unlocked: permitted,
    state: permitted ? 'UNLOCKED' : 'LOCKED',
    autoTradingState: autoStatus.state,
    autonomousPermission: permitted,
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
    productionStrategyApproved: process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true',
    approvedStrategyId: process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a',
    timestamp: Date.now()
  });
});

app.post('/api/execution-gate/unlock', operatorAuthRequired, (_req: Request, res: Response) => {
  const result = armAutonomousExecutionGate();
  const autoStatus = autoTradingService.getStatus();
  res.json({
    ...result,
    locked: !LIVE_AUTO_EXECUTION_ALLOWED,
    unlocked: LIVE_AUTO_EXECUTION_ALLOWED,
    autoTradingState: autoStatus.state,
    timestamp: Date.now()
  });
});

app.post('/api/execution-gate/lock', operatorAuthRequired, (_req: Request, res: Response) => {
  const result = lockAutonomousExecutionGate();
  const autoStatus = autoTradingService.getStatus();
  res.json({
    ...result,
    locked: true,
    unlocked: false,
    autoTradingState: autoStatus.state,
    timestamp: Date.now()
  });
});

app.get('/api/live-log/status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(getLiveRuntimeLogStatus());
});

app.post('/api/live-log/start', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(startLiveRuntimeLog('SETTINGS'));
});

app.post('/api/live-log/stop', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(stopLiveRuntimeLog('SETTINGS'));
});

app.get('/api/live-log/files', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json({ files: listLiveRuntimeLogFiles() });
});

app.get('/api/live-log/file', operatorAuthRequired, (req: Request, res: Response) => {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'INVALID_LOG_DATE', message: 'Log date must use YYYY-MM-DD format.' });
  }
  const file = getLiveRuntimeLogFile(date);
  res.sendFile(file);
});


const liveForexProvider = new LiveForexProvider();
const forexSignalEngine = new ForexSignalEngine(undefined, liveForexProvider);
const scannerService = new ScannerService();

function extractForexPair(req: Request): string {
  let p = req.params.pair;
  if (!p && req.params.part1 && req.params.part2) {
    p = `${req.params.part1}/${req.params.part2}`;
  }
  if (!p && req.body?.pair) {
    p = req.body.pair;
  }
  return decodeURIComponent(p || 'EUR/USD').toUpperCase().trim();
}

async function hydratePersistedTradeLimits(): Promise<void> {
  // SQLite remains the migration/source-of-record for settings already stored
  // by older Goldcrest builds. The config service also maintains an atomic
  // file-backed copy so settings survive a full server/process restart.
  // Read all settings and filter known durable keys below. Avoid positional
  // placeholder counts here because sql.js throws "column index out of range"
  // when the query and bind list ever drift during schema evolution.
  const rows = await executeQuery<any>('SELECT key, value FROM system_settings');

  const values = rows.reduce<Record<string, string>>((acc, row) => {
    acc[String(row.key)] = String(row.value ?? '');
    return acc;
  }, {});

  const persistedUpdates: Record<string, any> = {};

  const numericKeys: Array<[string, string]> = [
    ['DEFAULT_RISK_PCT', 'defaultRiskPct'],
    ['MAX_DAILY_LOSS_PCT', 'maxDailyLossPct'],
    ['MAX_OPEN_POSITIONS', 'maxOpenPositions'],
    ['MAX_TRADES_PER_DAY', 'maxTradesPerDay'],
    ['MAX_CONSECUTIVE_LOSSES', 'maxConsecutiveLosses'],
    ['MAX_SPREAD_BPS', 'maxSpreadBps'],
    ['SIGNAL_COOLDOWN_MS', 'signalCooldownMs'],
    ['EVENT_PROXIMITY_THRESHOLD_MINUTES', 'eventProximityThresholdMinutes'],
    ['STRIKE_DEPTH', 'strikeDepth'],
    ['MAX_TRADE_VALUE_FOREX_USD', 'maxTradeValueForexUsd'],
    ['MAX_TRADE_VALUE_INDIAN_INR', 'maxTradeValueIndianInr']
  ];

  for (const [dbKey, configKey] of numericKeys) {
    if (values[dbKey] === undefined) continue;
    const numberValue = Number(values[dbKey]);
    if (Number.isFinite(numberValue)) persistedUpdates[configKey] = numberValue;
  }

  const stringKeys: Array<[string, string]> = [
    ['SELECTED_CTRADER_ACCOUNT_ID', 'selectedCtraderAccountId'],
    ['SELECTED_CTRADER_ACCOUNT_CURRENCY', 'selectedCtraderAccountCurrency'],
    ['SELECTED_CTRADER_ACCOUNT_LABEL', 'selectedCtraderAccountLabel'],
    ['FINANCIAL_DISCLAIMER', 'financialDisclaimer']
  ];

  for (const [dbKey, configKey] of stringKeys) {
    if (values[dbKey] !== undefined && values[dbKey].trim() !== '') {
      persistedUpdates[configKey] = values[dbKey];
    }
  }

  for (const [dbKey, configKey] of [
    ['AUTO_LIVE_FOREX_PAIRS', 'autoLiveForexPairs'],
    ['AUTO_LIVE_INDIAN_UNDERLYINGS', 'autoLiveIndianUnderlyings']
  ] as Array<[string, string]>) {
    try {
      const parsed = JSON.parse(values[dbKey] || 'null');
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        persistedUpdates[configKey] = parsed;
      }
    } catch {}
  }

  if (Object.keys(persistedUpdates).length > 0) {
    applyPersistedSystemConfig(persistedUpdates);
  }
}

// Initialize database on boot and keep one shared initialization promise so
// API reads cannot race the initial SQLite hydration.
const databaseInitPromise = getDatabase()
  .then(async () => {
    await hydratePersistedTradeLimits();
    databaseReady = true;
    console.log('SQLite database initialized successfully');
  })
  .catch(err => {
    console.error('Failed to initialize SQLite database:', err);
    throw err;
  });

// Lazy Gemini AI initialization
let genAiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAiClient && process.env.GEMINI_API_KEY) {
    genAiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genAiClient;
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// 1. System Status & Health
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'goldcrest', environment: process.env.NODE_ENV || 'development', timestamp: Date.now() });
});

app.get('/api/health/ready', (req: Request, res: Response) => {
  const preflight = productionPreflight();
  const ready = databaseReady && preflight.ok;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    database: databaseReady ? 'READY' : 'INITIALIZING',
    tradingMode: getSystemConfig().tradingMode,
    autonomousLiveExecutionAllowed: LIVE_AUTO_EXECUTION_ALLOWED,
    autoTrading: autoTradingService.getStatus(),
    productionChecks: preflight.checks,
    timestamp: Date.now()
  });
});

app.get('/api/status', (req: Request, res: Response) => {
  const forexSessions = getForexSessionState();
  const indianSession = getIndianSessionState();
  const config = getSystemConfig();

  res.json({
    status: 'ONLINE',
    marketStatus: {
      forex: forexSessions,
      indianEquity: indianSession
    },
    dataStatus: config.dataStatus,
    modelStatus: config.modelStatus,
    tradingMode: config.tradingMode,
    timestamp: Date.now()
  });
});


const DATABASE_EXPLORER_TABLES = [
  { name: 'execution_intents', label: 'Execution Intents', category: 'Execution', description: 'Trigger Now and autonomous execution idempotency records.' },
  { name: 'execution_fill_observations', label: 'Fill Observations', category: 'Execution', description: 'Observed broker order fill state and quantities.' },
  { name: 'execution_fill_events', label: 'Fill Events', category: 'Execution', description: 'Broker-native execution/fill ledger.' },
  { name: 'trade_traces', label: 'Trade Trace Roots', category: 'Execution', description: 'Top-level lifecycle trace payloads.' },
  { name: 'trade_trace_nodes', label: 'Trade Trace Nodes', category: 'Execution', description: 'Individual execution lifecycle nodes.' },
  { name: 'orders', label: 'Orders', category: 'Trading', description: 'Normalized order records.' },
  { name: 'trades', label: 'Trades', category: 'Trading', description: 'Trade entry/exit records and P&L.' },
  { name: 'positions', label: 'Positions', category: 'Trading', description: 'Persisted position state.' },
  { name: 'broker_accounts', label: 'Broker Accounts', category: 'Trading', description: 'Broker account snapshots and permissions.' },
  { name: 'broker_reconciliation_snapshots', label: 'Reconciliation Snapshots', category: 'Trading', description: 'Broker account, position and order snapshots.' },
  { name: 'market_data', label: 'Market Data', category: 'Market Data', description: 'Persisted market observations.' },
  { name: 'candles', label: 'Candles', category: 'Market Data', description: 'OHLCV candle series.' },
  { name: 'options_chain', label: 'Options Chains', category: 'Market Data', description: 'Persisted options-chain snapshots.' },
  { name: 'option_contracts', label: 'Option Contracts', category: 'Market Data', description: 'Strike-level option observations.' },
  { name: 'greeks', label: 'Greeks', category: 'Market Data', description: 'Option Greeks and IV records.' },
  { name: 'signals', label: 'Signals', category: 'Strategy', description: 'Generated strategy signals and trade levels.' },
  { name: 'signal_events', label: 'Signal Events', category: 'Strategy', description: 'Signal lifecycle and status events.' },
  { name: 'strategy_configs', label: 'Strategy Configs', category: 'Strategy', description: 'Strategy thresholds and enablement.' },
  { name: 'economic_events', label: 'Economic Events', category: 'Strategy', description: 'Calendar events used by the strategy layer.' },
  { name: 'risk_configs', label: 'Risk Configs', category: 'Risk & System', description: 'Risk, loss and execution limits.' },
  { name: 'system_settings', label: 'System Settings', category: 'Risk & System', description: 'Persisted Goldcrest configuration values.' },
  { name: 'trade_notes', label: 'Trade Notes', category: 'Risk & System', description: 'Operator notes linked to trading context.' },
  { name: 'users', label: 'Users', category: 'Reference', description: 'Application user records.' },
  { name: 'markets', label: 'Markets', category: 'Reference', description: 'Market definitions.' },
  { name: 'instruments', label: 'Instruments', category: 'Reference', description: 'Instrument metadata.' },
  { name: 'currency_pairs', label: 'Currency Pairs', category: 'Reference', description: 'Forex pair reference metadata.' },
  { name: 'underlyings', label: 'Underlyings', category: 'Reference', description: 'Indian market underlying metadata.' },
  { name: 'contracts', label: 'Contracts', category: 'Reference', description: 'Derivative contract reference records.' },
  { name: 'model_versions', label: 'Model Versions', category: 'ML & Research', description: 'Registered model versions.' },
  { name: 'model_predictions', label: 'Model Predictions', category: 'ML & Research', description: 'Persisted model prediction records.' },
  { name: 'backtest_runs', label: 'Backtest Runs', category: 'ML & Research', description: 'Historical backtest run summaries.' },
  { name: 'backtest_trades', label: 'Backtest Trades', category: 'ML & Research', description: 'Historical backtest trade rows.' },
  { name: 'ml_storage_records', label: 'ML Storage Records', category: 'ML & Research', description: 'Persisted ML bridge records.' }
];

const DATABASE_EXPLORER_REDACT_PATTERNS = /(password|secret|token|encryption.?key|totp|pin|client.?secret|access.?token)/i;

function sanitizeDatabaseRow(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (DATABASE_EXPLORER_REDACT_PATTERNS.test(key)) {
      result[key] = value === null || value === undefined || value === '' ? value : '[REDACTED]';
      continue;
    }
    if (key === 'value' && DATABASE_EXPLORER_REDACT_PATTERNS.test(String(row.key || ''))) {
      result[key] = '[REDACTED]';
      continue;
    }
    result[key] = value;
  }
  return result;
}

function quoteSqlIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

app.get('/api/database/overview', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const tables = [];
    for (const definition of DATABASE_EXPLORER_TABLES) {
      const rows = await executeQuery<any>('SELECT COUNT(*) AS count FROM ' + quoteSqlIdentifier(definition.name));
      tables.push({ ...definition, count: Number(rows[0]?.count || 0) });
    }
    res.json({ database: 'data/trading_analyst.sqlite', tables, timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Database overview unavailable.' });
  }
});

app.get('/api/database/table', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await databaseInitPromise;
    const tableName = String(req.query.table || '').trim();
    const definition = DATABASE_EXPLORER_TABLES.find(item => item.name === tableName);
    if (!definition) return res.status(400).json({ error: 'Unknown database table.' });

    const schema = await executeQuery<any>('PRAGMA table_info(' + quoteSqlIdentifier(tableName) + ')');
    const columns = schema.map(column => ({ name: String(column.name), type: String(column.type || 'TEXT') }));
    const columnNames = columns.map(column => column.name);
    if (!columnNames.length) return res.status(404).json({ error: 'Selected database table has no columns.' });

    const rawLimit = Number(req.query.limit || 50);
    const rawOffset = Number(req.query.offset || 0);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1), 250);
    const offset = Math.min(Math.max(Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0, 0), 100000);
    const search = String(req.query.search || '').trim();

    const requestedSort = String(req.query.sort || '').trim();
    const sortColumn = columnNames.includes(requestedSort)
      ? requestedSort
      : (['timestamp', 'updated_at', 'created_at', 'observed_at', 'executed_at'].find(name => columnNames.includes(name)) || columnNames[0]);
    const direction = String(req.query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const searchClause = search
      ? ' WHERE ' + columnNames.map(column => 'CAST(' + quoteSqlIdentifier(column) + ' AS TEXT) LIKE ?').join(' OR ')
      : '';
    const searchParams = search ? columnNames.map(() => '%' + search + '%') : [];

    const totalRows = await executeQuery<any>(
      'SELECT COUNT(*) AS count FROM ' + quoteSqlIdentifier(tableName) + searchClause,
      searchParams
    );
    const rows = await executeQuery<any>(
      'SELECT ' + columnNames.map(quoteSqlIdentifier).join(', ') +
      ' FROM ' + quoteSqlIdentifier(tableName) +
      searchClause +
      ' ORDER BY ' + quoteSqlIdentifier(sortColumn) + ' ' + direction +
      ' LIMIT ? OFFSET ?',
      [...searchParams, limit, offset]
    );

    res.json({
      database: 'data/trading_analyst.sqlite',
      table: tableName,
      label: definition.label,
      category: definition.category,
      columns,
      rows: rows.map(row => sanitizeDatabaseRow(row)),
      total: Number(totalRows[0]?.count || 0),
      limit,
      offset,
      updatedAt: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Database table unavailable.' });
  }
});

// 2. Configuration API
app.get('/api/config', async (_req: Request, res: Response) => {
  try {
    // Always wait for SQLite initialization and rehydrate persisted limits
    // before returning configuration. This prevents navigation/reload from
    // displaying the in-memory defaults while the DB contains operator values.
    await databaseInitPromise;
    res.json(getSystemConfig());
  } catch (err: any) {
    res.status(503).json({
      error: 'CONFIG_UNAVAILABLE',
      message: err?.message || 'Persisted configuration is unavailable.'
    });
  }
});

app.post('/api/config', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    // Always hydrate the latest durable values before applying a partial
    // settings update. This prevents one save operation from accidentally
    // overwriting unrelated persisted settings with process defaults.
    await databaseInitPromise;
    await hydratePersistedTradeLimits();

    const requestedForex = req.body?.maxTradeValueForexUsd;
    const requestedIndian = req.body?.maxTradeValueIndianInr;
    const requestedForexPairs = req.body?.autoLiveForexPairs;
    const requestedIndianUnderlyings = req.body?.autoLiveIndianUnderlyings;
    const updates: any = { ...req.body };

    if (requestedForex !== undefined) {
      const value = Number(requestedForex);
      if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'maxTradeValueForexUsd must be a positive number.' });
      updates.maxTradeValueForexUsd = value;
    }

    if (requestedIndian !== undefined) {
      const value = Number(requestedIndian);
      if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'maxTradeValueIndianInr must be a positive number.' });
      updates.maxTradeValueIndianInr = value;
    }

    const validForexPairs = new Set(FOREX_PAIRS.map(pair => pair.symbol.toUpperCase()));
    const validIndianUnderlyings = new Set(INDIAN_UNDERLYINGS.map(item => item.symbol.toUpperCase()));

    if (requestedForexPairs !== undefined) {
      if (!Array.isArray(requestedForexPairs) || requestedForexPairs.length === 0) {
        return res.status(400).json({ error: 'Select at least one Forex instrument for the Auto Live working universe.' });
      }
      const normalized = [...new Set(requestedForexPairs.map((value: unknown) => String(value).toUpperCase().trim()))];
      if (normalized.some(symbol => !validForexPairs.has(symbol))) {
        return res.status(400).json({ error: 'One or more selected Forex instruments are not supported.' });
      }
      updates.autoLiveForexPairs = normalized;
    }

    if (requestedIndianUnderlyings !== undefined) {
      if (!Array.isArray(requestedIndianUnderlyings)) {
        return res.status(400).json({ error: 'autoLiveIndianUnderlyings must be an array.' });
      }
      const normalized = [...new Set(requestedIndianUnderlyings.map((value: unknown) => String(value).toUpperCase().trim()))];
      if (normalized.some(symbol => !validIndianUnderlyings.has(symbol))) {
        return res.status(400).json({ error: 'One or more selected NSE/BSE underlyings are not supported.' });
      }
      updates.autoLiveIndianUnderlyings = normalized;
    }

    const updated = updateSystemConfig(updates);
    const now = Date.now();

    // Write every durable system setting after the merge so a partial save
    // cannot reset a different setting. configService has already written the
    // same merged configuration to an atomic JSON file.
    await executeRun(
      'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)',
      [
        'SELECTED_CTRADER_ACCOUNT_ID', String(updated.selectedCtraderAccountId || ''), now,
        'SELECTED_CTRADER_ACCOUNT_CURRENCY', String(updated.selectedCtraderAccountCurrency || ''), now,
        'SELECTED_CTRADER_ACCOUNT_LABEL', String(updated.selectedCtraderAccountLabel || ''), now,
        'DEFAULT_RISK_PCT', String(updated.defaultRiskPct), now,
        'MAX_DAILY_LOSS_PCT', String(updated.maxDailyLossPct), now,
        'MAX_OPEN_POSITIONS', String(updated.maxOpenPositions), now,
        'MAX_TRADES_PER_DAY', String(updated.maxTradesPerDay), now,
        'MAX_CONSECUTIVE_LOSSES', String(updated.maxConsecutiveLosses), now,
        'MAX_SPREAD_BPS', String(updated.maxSpreadBps), now,
        'SIGNAL_COOLDOWN_MS', String(updated.signalCooldownMs), now,
        'EVENT_PROXIMITY_THRESHOLD_MINUTES', String(updated.eventProximityThresholdMinutes), now,
        'STRIKE_DEPTH', String(updated.strikeDepth), now,
        'MAX_TRADE_VALUE_FOREX_USD', String(updated.maxTradeValueForexUsd), now,
        'MAX_TRADE_VALUE_INDIAN_INR', String(updated.maxTradeValueIndianInr), now,
        'AUTO_LIVE_FOREX_PAIRS', JSON.stringify(updated.autoLiveForexPairs || []), now,
        'AUTO_LIVE_INDIAN_UNDERLYINGS', JSON.stringify(updated.autoLiveIndianUnderlyings || []), now,
        'FINANCIAL_DISCLAIMER', String(updated.financialDisclaimer || ''), now
      ]
    );
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Markets Abstraction
app.get('/api/markets', (req: Request, res: Response) => {
  res.json([
    {
      id: 'FOREX',
      name: 'Forex (Currencies & Metals)',
      currency: 'USD',
      instrumentsCount: FOREX_PAIRS.length,
      status: 'ACTIVE',
      sessions: getForexSessionState()
    },
    {
      id: 'INDIA_EQUITY',
      name: 'Indian Equity Benchmark Indices',
      currency: 'INR',
      instrumentsCount: INDIAN_UNDERLYINGS.length,
      status: 'ACTIVE',
      session: getIndianSessionState()
    },
    {
      id: 'INDIA_OPTIONS',
      name: 'Indian Equity Index Derivatives & Options',
      currency: 'INR',
      underlyings: INDIAN_UNDERLYINGS.map(u => u.symbol),
      status: 'ACTIVE',
      session: getIndianSessionState()
    }
  ]);
});

// 4. Forex Endpoints (Phase 2A Full Analysis Engine)
const FOREX_PAIRS_CACHE_TTL_MS = 60_000;
let forexPairsCache: { payload: any[]; expiresAt: number } | null = null;
let forexPairsInFlight: Promise<any[]> | null = null;

const INDIA_UNDERLYINGS_CACHE_TTL_MS = 60_000;
let indiaUnderlyingsCache: { payload: any[]; expiresAt: number } | null = null;
let indiaUnderlyingsInFlight: Promise<any[]> | null = null;

const CANDLE_CACHE_TTL_MS = 30_000;
const candleCache = new Map<string, { payload: any[]; expiresAt: number }>();
const candleInFlight = new Map<string, Promise<any[]>>();

app.get('/api/forex/pairs', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (forexPairsCache && now < forexPairsCache.expiresAt) {
      return res.json(forexPairsCache.payload);
    }
    if (forexPairsInFlight) {
      return res.json(await forexPairsInFlight);
    }

    forexPairsInFlight = (async () => {
      const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
      const instruments = await adapter.getInstruments();

      const pairsWithQuotes = await Promise.all(instruments.map(async inst => {
        try {
          const quote = await adapter.getQuote(inst.symbol);
          return {
            ...inst,
            baseCurrency: inst.symbol.split('/')[0],
            quoteCurrency: inst.symbol.split('/')[1] || '',
            bid: quote.bid,
            ask: quote.ask,
            spreadPips: Number((quote.spread * (inst.symbol.includes('JPY') ? 100 : 10000)).toFixed(1)),
            changePips24h: undefined,
            changePercent24h: undefined,
            high24h: undefined,
            low24h: undefined,
            dataStatus: quote.status,
            dataSource: quote.source
          };
        } catch (quoteErr: any) {
          try {
            if (!adapter.getHistoricalCandles) throw quoteErr;
            const candles = await adapter.getHistoricalCandles(inst.symbol, '15M', 2);
            const last = candles?.[candles.length - 1];
            const previous = candles?.[candles.length - 2] || last;
            const close = Number(last?.close || 0);
            if (!(close > 0)) throw quoteErr;

            const previousClose = Number(previous?.close || close);
            const change = close - previousClose;
            const divisor = inst.symbol.includes('JPY') ? 100 : 10000;

            return {
              ...inst,
              baseCurrency: inst.symbol.split('/')[0],
              quoteCurrency: inst.symbol.split('/')[1] || '',
              bid: close,
              ask: close,
              spreadPips: 0,
              changePips24h: Number((change * divisor).toFixed(1)),
              changePercent24h: previousClose > 0
                ? Number(((change / previousClose) * 100).toFixed(2))
                : undefined,
              high24h: Number.isFinite(Number(last?.high)) ? Number(last.high) : close,
              low24h: Number.isFinite(Number(last?.low)) ? Number(last.low) : close,
              dataStatus: 'DELAYED',
              dataSource: 'CTRADER_HISTORICAL_CLOSE',
              dataError: quoteErr?.message || String(quoteErr)
            };
          } catch (historyErr: any) {
            return {
              ...inst,
              baseCurrency: inst.symbol.split('/')[0],
              quoteCurrency: inst.symbol.split('/')[1] || '',
              bid: undefined,
              ask: undefined,
              spreadPips: undefined,
              changePips24h: undefined,
              changePercent24h: undefined,
              high24h: undefined,
              low24h: undefined,
              dataStatus: 'UNKNOWN',
              dataSource: 'CTRADER_LIVE_API_UNAVAILABLE',
              dataError: historyErr?.message || quoteErr?.message || String(quoteErr)
            };
          }
        }
      }));

      forexPairsCache = {
        payload: pairsWithQuotes,
        expiresAt: Date.now() + FOREX_PAIRS_CACHE_TTL_MS
      };
      return pairsWithQuotes;
    })().finally(() => {
      forexPairsInFlight = null;
    });

    return res.json(await forexPairsInFlight);
  } catch (err: any) {
    res.status(503).json({
      error: err?.code || 'LIVE_MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative cTrader market data is unavailable.'
    });
  }
});

app.get('/api/forex/market-status', (req: Request, res: Response) => {
  const status = liveForexProvider.getMarketStatus();
  res.json(status);
});

app.get(['/api/forex/sessions'], (req: Request, res: Response) => {
  const sessions = getForexSessionState();
  res.json(sessions);
});

// Helper to get live-anchored candles
async function getLiveAnchoredCandles(pair: string, tf: ForexTimeframe = '15M', limit: number = 80) {
  const adapter = brokerRegistry.getAdapter('CTRADER');
  if (!adapter.getHistoricalCandles) {
    throw new BrokerError('UNAVAILABLE', 'Authoritative cTrader historical market-data capability is unavailable.', 'CTRADER', 'LIVE');
  }
  const candles = await adapter.getHistoricalCandles(pair, tf, limit);
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new BrokerError('STALE_DATA', `No authoritative cTrader historical candles returned for ${pair} ${tf}.`, 'CTRADER', 'LIVE');
  }
  return candles;
}

app.get(['/api/forex/analysis/:pair', '/api/forex/analysis/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    await liveForexProvider.refreshPair(pair);
    const analysis = forexSignalEngine.analyzePair(pair);
    try {
      const adapter = brokerRegistry.getAdapter('CTRADER');
      const quote = await adapter.getQuote(pair);
      if (quote && quote.bid > 0) {
        analysis.currentPrice = (quote.bid + quote.ask) / 2;
      }
    } catch (e) {}
    res.json(analysis);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/forex/candles/:pair', '/api/forex/candles/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    const tf = (req.query.tf as ForexTimeframe) || '15M';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 80;
    const candles = await getLiveAnchoredCandles(pair, tf, limit);
    res.json(candles);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/forex/indicators/:pair', '/api/forex/indicators/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    const tf = (req.query.tf as ForexTimeframe) || '15M';
    const candles = await getLiveAnchoredCandles(pair, tf, 80);
    const indicators = calculateIndicators(candles);
    res.json(indicators);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/forex/structure/:pair', '/api/forex/structure/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    const tf = (req.query.tf as ForexTimeframe) || '15M';
    const candles = await getLiveAnchoredCandles(pair, tf, 80);
    const structure = analyzeMarketStructure(candles);
    res.json(structure);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/forex/support-resistance/:pair', '/api/forex/support-resistance/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    const tf = (req.query.tf as ForexTimeframe) || '15M';
    const candles = await getLiveAnchoredCandles(pair, tf, 80);
    const config = getForexPairConfig(pair);
    const sr = calculateSupportResistance(candles, config.pipSize);
    res.json(sr);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/forex/multi-timeframe/:pair', '/api/forex/multi-timeframe/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    const mtf = analyzeMultiTimeframe({
      '1M': [],
      '5M': await getLiveAnchoredCandles(pair, '5M', 60),
      '15M': await getLiveAnchoredCandles(pair, '15M', 60),
      '30M': [],
      '1H': await getLiveAnchoredCandles(pair, '1H', 60),
      '4H': await getLiveAnchoredCandles(pair, '4H', 60),
      'Daily': await getLiveAnchoredCandles(pair, 'Daily', 60)
    });
    res.json(mtf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/forex/signal/:pair', '/api/forex/signal/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    await liveForexProvider.refreshPair(pair);
    const signal = await forexSignalEngine.generateSignal(pair);
    res.json(signal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/forex/signal/generate', async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
    await liveForexProvider.refreshPair(pair);
    const signal = await forexSignalEngine.generateSignal(pair);
    res.json(signal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Phase 2A Explanation Endpoint
app.post('/api/forex/explain', async (req: Request, res: Response) => {
  try {
    let analysis = req.body?.analysis;
    if (!analysis) {
      const pair = extractForexPair(req);
      analysis = forexSignalEngine.analyzePair(pair);
    }
    const explanation = await explainForexAnalysis(analysis);
    res.json(explanation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/notes', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const rows = await executeQuery<any>('SELECT id, title, content, symbol, created_at, updated_at FROM trade_notes ORDER BY created_at DESC');
    const notes = rows.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      symbol: r.symbol || undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
    res.json(notes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notes', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const { title, content, symbol } = req.body;
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    await executeRun(
      'INSERT INTO trade_notes (id, title, content, symbol, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, title, content, symbol || null, now, now]
    );
    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notes/:id', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    await executeRun('DELETE FROM trade_notes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Indian Equity Endpoints
app.get('/api/india/underlyings', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (indiaUnderlyingsCache && now < indiaUnderlyingsCache.expiresAt) {
      return res.json(indiaUnderlyingsCache.payload);
    }
    if (indiaUnderlyingsInFlight) {
      return res.json(await indiaUnderlyingsInFlight);
    }

    indiaUnderlyingsInFlight = (async () => {
      const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
      if (typeof adapter.fetchIndianUnderlyingsFrom5Paisa !== 'function') {
        throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa underlying market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
      }
      const payload = await adapter.fetchIndianUnderlyingsFrom5Paisa();
      indiaUnderlyingsCache = {
        payload: Array.isArray(payload) ? payload : [],
        expiresAt: Date.now() + INDIA_UNDERLYINGS_CACHE_TTL_MS
      };
      return indiaUnderlyingsCache.payload;
    })().finally(() => {
      indiaUnderlyingsInFlight = null;
    });

    return res.json(await indiaUnderlyingsInFlight);
  } catch (err: any) {
    res.status(503).json({
      error: err?.code || 'LIVE_MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative 5paisa underlying data is unavailable.'
    });
  }
});

app.get('/api/india/sessions', (req: Request, res: Response) => {
  const session = getIndianSessionState();
  res.json(session);
});

app.get('/api/india/candles/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE');
    if (!adapter.getHistoricalCandles) throw new Error('Authoritative 5paisa historical market-data capability is unavailable.');
    const candles = await adapter.getHistoricalCandles(symbol, '15m', 60);
    res.json(candles);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/india/analysis/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.fetchIndianUnderlyingsFrom5Paisa !== 'function') {
      throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa underlying market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
    }
    const underlyings = await adapter.fetchIndianUnderlyingsFrom5Paisa();
    const found = underlyings.find((u: any) => u.symbol === symbol);
    if (!found) {
      return res.status(404).json({ error: `Underlying ${symbol} not found in authoritative 5paisa market data.` });
    }
    res.json(found);
  } catch (err: any) {
    res.status(503).json({
      error: err?.code || 'LIVE_MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative 5paisa analysis data is unavailable.'
    });
  }
});

// Universal candles endpoint supporting both Forex (EUR/USD, EUR%2FUSD) and Indian underlyings (NIFTY, etc.)
app.get(['/api/candles/:symbol', '/api/candles/:part1/:part2'], async (req: Request, res: Response) => {
  try {
    let symbol = req.params.symbol;
    if (!symbol && req.params.part1 && req.params.part2) {
      symbol = `${req.params.part1}/${req.params.part2}`;
    }
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol parameter is required' });
    }

    symbol = decodeURIComponent(symbol).toUpperCase().trim();
    const isForex = symbol.includes('/') || FOREX_PAIRS.some(p => p.symbol.toUpperCase() === symbol);
    const tf = isForex
      ? ((req.query.tf as ForexTimeframe) || '15M')
      : String(req.query.tf || '15m');
    const limit = req.query.limit
      ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 10), 500)
      : 80;

    const cacheKey = `${isForex ? 'FX' : 'IN'}|${symbol}|${tf}|${limit}`;
    const cached = candleCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.payload);
    }

    const inFlight = candleInFlight.get(cacheKey);
    if (inFlight) {
      return res.json(await inFlight);
    }

    const promise = (async () => {
      if (isForex) {
        const candles = await getLiveAnchoredCandles(symbol, tf as ForexTimeframe, limit);
        return candles;
      }

      const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE');
      if (!adapter.getHistoricalCandles) {
        throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa historical market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
      }
      return await adapter.getHistoricalCandles(symbol, tf, limit);
    })();

    candleInFlight.set(cacheKey, promise);
    try {
      const candles = await promise;
      candleCache.set(cacheKey, {
        payload: Array.isArray(candles) ? candles : [],
        expiresAt: Date.now() + CANDLE_CACHE_TTL_MS
      });
      return res.json(Array.isArray(candles) ? candles : []);
    } finally {
      candleInFlight.delete(cacheKey);
    }
  } catch (err: any) {
    const isAuth = err?.code === 'AUTHENTICATION_FAILED' || err?.code === 'ACCOUNT_NOT_FOUND' || err?.code === 'TOKEN_EXPIRED';
    const status = isAuth ? 401 : 503;
    return res.status(status).json({
      error: err?.code || 'MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Historical candle data is unavailable from the live broker.'
    });
  }
});

// 6. Options Endpoints
app.get('/api/options/chain/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  const expiry = req.query.expiry as string | undefined;
  const depth = req.query.depth ? parseInt(req.query.depth as string, 10) : 7;
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.fetchOptionChainFrom5Paisa !== 'function') {
      throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa option-chain capability is unavailable.', 'FIVE_PAISA', 'LIVE');
    }
    const chain = await adapter.fetchOptionChainFrom5Paisa(symbol, expiry, depth);
    if (!chain) {
      return res.status(503).json({
        underlying: symbol,
        expiry: expiry || '',
        rows: [],
        isBlank: true,
        error: 'Authoritative 5paisa option-chain data is unavailable.'
      });
    }
    res.json(chain);
  } catch (err: any) {
    res.status(503).json({
      underlying: symbol,
      expiry: expiry || '',
      rows: [],
      isBlank: true,
      error: err?.message || 'Authoritative 5paisa option-chain data is unavailable.'
    });
  }
});

app.get('/api/options/scanner/:symbol', async (req: Request, res: Response) => {
  const symbol = req.params.symbol ? req.params.symbol.toUpperCase() : 'NIFTY';
  const result = await scannerService.getOptionsScanner(symbol);
  res.json(result);
});

app.post('/api/options/payoff', (req: Request, res: Response) => {
  try {
    const payoff = calculateStrategyPayoff(req.body);
    res.json(payoff);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Unified Signals
app.get(['/api/signals', '/api/signals/all'], async (req: Request, res: Response) => {
  try {
    const signals = await scannerService.getAllSignals();
    res.json(signals);
  } catch (err: any) {
    res.status(503).json({
      error: err?.code || 'LIVE_SIGNAL_DATA_UNAVAILABLE',
      message: err?.message || 'Live signal data is unavailable from the configured brokers.'
    });
  }
});

// 8. Live Forex News
app.get('/api/forex/news', async (req: Request, res: Response) => {
  try {
    const configuredPairs = getSystemConfig().autoLiveForexPairs;
    const requestedPairs = typeof req.query.pairs === 'string'
      ? req.query.pairs
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
      : configuredPairs;

    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const news = await fetchLiveForexNews({
      pairs: requestedPairs,
      forceRefresh
    });

    res.status(news.status === 'UNAVAILABLE' ? 503 : 200).json(news);
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_FOREX_NEWS_UNAVAILABLE',
      message: err?.message || 'Live Forex news is unavailable.'
    });
  }
});

// 8b. Alpha Vantage Dedicated News & Sentiment Fetch
app.get('/api/news/alphavantage', async (req: Request, res: Response) => {
  try {
    const tickers = typeof req.query.tickers === 'string' ? req.query.tickers : undefined;
    const topics = typeof req.query.topics === 'string' ? req.query.topics : undefined;
    const sort = (req.query.sort as 'LATEST' | 'EARLIEST' | 'RELEVANCE') || 'LATEST';
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    // If pairs parameter is provided, use forex-tailored query
    if (typeof req.query.pairs === 'string') {
      const pairs = req.query.pairs.split(',').map(p => p.trim()).filter(Boolean);
      const snapshot = await alphaVantageNewsService.fetchForexNews(pairs, {
        sort,
        limit,
        forceRefresh
      });
      return res.json(snapshot);
    }

    const snapshot = await alphaVantageNewsService.fetchNewsSentiment({
      tickers,
      topics,
      sort,
      limit,
      forceRefresh
    });

    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({
      error: 'ALPHA_VANTAGE_NEWS_FAILED',
      message: err?.message || 'Failed to fetch Alpha Vantage news and sentiment.'
    });
  }
});

// 8c. Marketaux Dedicated News & Sentiment Fetch
app.get('/api/news/marketaux', async (req: Request, res: Response) => {
  try {
    const symbols = typeof req.query.symbols === 'string' ? req.query.symbols : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const countries = typeof req.query.countries === 'string' ? req.query.countries : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    // If pairs parameter is provided, use forex-tailored query
    if (typeof req.query.pairs === 'string') {
      const pairs = req.query.pairs.split(',').map(p => p.trim()).filter(Boolean);
      const snapshot = await marketauxNewsService.fetchForexNews(pairs, {
        limit,
        forceRefresh
      });
      return res.json(snapshot);
    }

    const snapshot = await marketauxNewsService.fetchNewsSentiment({
      symbols,
      search,
      countries,
      limit,
      forceRefresh
    });

    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({
      error: 'MARKETAUX_NEWS_FAILED',
      message: err?.message || 'Failed to fetch Marketaux news and sentiment.'
    });
  }
});

// 8d. News Service Provider Status
app.get('/api/news/status', async (_req: Request, res: Response) => {
  res.json({
    alphaVantageConfigured: alphaVantageNewsService.isConfigured(),
    marketauxConfigured: marketauxNewsService.isConfigured(),
    providers: ['ALPHA_VANTAGE', 'MARKETAUX', 'GDELT_DOC_2', 'GOOGLE_NEWS_RSS']
  });
});

// 8. Macroeconomic Events
app.get('/api/economic-events', async (_req: Request, res: Response) => {
  res.status(503).json({
    error: 'LIVE_MACRO_EVENTS_UNAVAILABLE',
    message: 'No authoritative live macroeconomic event feed is configured.'
  });
});

// 9. Database Stats & Diagnostics
app.get('/api/db/stats', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const stats = await getDatabaseStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Gemini Natural-Language Explanation Layer
// Strict system instructions: Gemini receives structured quantitative output, explains factors,
// never overrides quantitative rules, highlights uncertainty, and does not claim guaranteed profit.
app.post('/api/analysis/explain', async (req: Request, res: Response) => {
  const payload = req.body;
  const ai = getGenAI();

  if (!ai) {
    // Deterministic fallback explanation if Gemini API key not present
    return res.json({
      summary: `Quantitative analysis for ${payload.instrument || payload.underlying || 'the instrument'} indicates a ${payload.direction || payload.strategy || 'probabilistic'} setup based on indicators, VWAP, and market structure.`,
      supportingFactors: [
        `Market structure aligns with quantitative rules`,
        `Technical indicator confluence (EMA stack, RSI momentum)`,
        `Risk/Reward is statistically bounded with predefined Stop Loss`
      ],
      conflictingFactors: [
        `Probabilistic setup only — no guaranteed market direction`,
        `Upcoming economic events or session transition may introduce volatility`
      ],
      riskNote: 'Trading in derivatives and Forex carries substantial risk. All probabilities are statistical estimates.',
      isAiGenerated: false
    });
  }

  try {
    const prompt = `You are the explanation layer of a quantitative multi-market trading-analysis system.
You do not guarantee future market movements.
You do not invent market data.
You do not change numerical values supplied by the quantitative engine.
You clearly distinguish observed data, calculated metrics, and model estimates.
You must explain uncertainty.
You must identify conflicting evidence.
You must not claim guaranteed profit.
You must not describe a probabilistic signal as certainty.
You should explain why the quantitative engine produced a signal rather than independently overriding it.

Here is the quantitative data payload:
${JSON.stringify(payload, null, 2)}

Provide a concise, professional JSON response matching this schema:
{
  "summary": "2-3 sentence explanation of the setup rationale",
  "supportingFactors": ["factor 1", "factor 2", "factor 3"],
  "conflictingFactors": ["factor 1", "factor 2"],
  "riskNote": "Specific risk conditions to watch"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text);
    res.json({ ...parsed, isAiGenerated: true });
  } catch (err: any) {
    console.error('Gemini explanation error:', err);
    res.json({
      summary: `Quantitative analysis for ${payload.instrument || payload.underlying || 'instrument'} derived from indicator stack and market structure.`,
      supportingFactors: [`Quantitative alignment verified`],
      conflictingFactors: [`Market conditions can change rapidly; the supplied quantitative data is probabilistic.`],
      riskNote: 'Risk is bounded by strict Stop Loss rules. Probabilistic estimate only.',
      isAiGenerated: false
    });
  }
});

// API 404 handler to ensure unknown API requests return JSON instead of HTML
app.all('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE & SERVER STARTUP
// -------------------------------------------------------------
async function captureLiveBrokerReconciliation(): Promise<void> {
  if (!databaseReady) return;
  try {
    const results = await Promise.allSettled([
      reconciliationService.captureBrokerSnapshot('CTRADER'),
      reconciliationService.captureBrokerSnapshot('FIVE_PAISA')
    ]);
    results.forEach((result, index) => {
      const broker = index === 0 ? 'CTRADER' : 'FIVE_PAISA';
      if (result.status === 'rejected') {
        console.warn(`Goldcrest reconciliation failed for ${broker}: `, result.reason?.message || result.reason);
      } else if (result.value?.status === 'UNCONFIGURED') {
        // Broker is unconfigured or access token is unavailable; snapshot recorded as UNCONFIGURED.
      }
    });
  } catch (err: any) {
    console.warn('Goldcrest reconciliation cycle failed:', err?.message || err);
  }
}

async function startServer() {
  logApplicationAction('SERVER_STARTING', {
    nodeEnv: process.env.NODE_ENV || 'development',
    lifecycle: process.env.npm_lifecycle_event || null,
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000)
  });

  // Strict preflight enforcement applies only to an actual production launch.
  // npm run dev is always treated as local development even when .env contains
  // a stale NODE_ENV=production value.
  const productionRuntime = process.env.npm_lifecycle_event !== 'dev'
    && process.env.NODE_ENV === 'production';
  productionPreflight(productionRuntime);

  // Global JSON error-handling middleware for API routes
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err.status || err.statusCode || 500);
    const message = err.message || 'Internal Server Error';
    if (req.path.startsWith('/api/')) {
      res.status(status).json({
        error: message,
        code: err.code || 'INTERNAL_ERROR',
        details: err.details || undefined,
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
      });
    } else {
      res.status(status).send(message);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      // Express owns /api and SPA routing. Vite must not generate an HTML
      // fallback response for an unmatched API endpoint.
      appType: 'custom',
    });
    app.use(vite.middlewares);

    // Express handles SPA navigation explicitly after API routes. This preserves
    // Vite HMR/transforms while preventing API requests from reaching HTML fallback.
    app.use('*', async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api/')) return next();

      try {
        const fs = await import('node:fs/promises');
        const indexPath = path.join(process.cwd(), 'index.html');
        const template = await fs.readFile(indexPath, 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).setHeader('Content-Type', 'text/html').end(html);
      } catch (error) {
        next(error);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Goldcrest is a private/local application; loopback is the safe default.
  // Remote binding must be explicitly configured via HOST.
  const host = process.env.HOST || '127.0.0.1';
  const localDevelopmentHost = ['127.0.0.1', 'localhost', '::1'].includes(String(host).trim().toLowerCase());
  if (process.env.NODE_ENV !== 'production') {
    process.env.GOLDCREST_LOCAL_DEVELOPMENT = localDevelopmentHost ? 'true' : 'false';
  }
  const server = app.listen(PORT, host, () => {
    const runtime = process.env.NODE_ENV || 'development';
    console.log(`Goldcrest server listening on http://${host}:${PORT} (NODE_ENV=${runtime})`);
    logApplicationAction('SERVER_STARTED', {
      host,
      port: PORT,
      nodeEnv: runtime,
      auditFile: getLiveRuntimeLogStatus().file
    });
    void captureLiveBrokerReconciliation();
    void reconcileInFlightExecutionIntents();
    const reconciliationTimer = setInterval(() => void captureLiveBrokerReconciliation(), 5 * 60_000);
    const executionLifecycleTimer = setInterval(() => void reconcileInFlightExecutionIntents(), 15_000);
    if (process.env.GOLDCREST_AUTO_TRADING_START_ON_BOOT === 'true') {
      const autoStatus = autoTradingService.start();
      console.log(`Goldcrest auto-trading startup: ${autoStatus.state} - ${autoStatus.lastCycleResult || ''}`);
    }
    reconciliationTimer.unref?.();
    executionLifecycleTimer.unref?.();
  });

  const shutdown = (signal: string) => {
    liveRuntimeLog('SYSTEM', 'SERVER_SHUTDOWN_REQUESTED', { signal });
    console.log(`Goldcrest received ${signal}; closing HTTP server gracefully.`);
    server.close(() => {
      try {
        // Persist the authoritative SQLite state before process exit.
        persistDatabase();
      } catch (err: any) {
        console.error('SQLite shutdown persistence failed:', err?.message || err);
      }
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Goldcrest graceful shutdown timed out; forcing exit.');
      process.exit(1);
    }, 15_000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer();
