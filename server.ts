import express, { Request, Response } from 'express';
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
import { ForexDemoProvider as LegacyForexProvider, IndianMarketDemoProvider, OptionsChainDemoProvider, EconomicCalendarDemoProvider } from './src/services/providers';
import { ScannerService } from './src/services/scannerService';
import { getSystemConfig, updateSystemConfig } from './src/services/configService';
import { calculateStrategyPayoff } from './src/markets/india_options/strategySkeleton';

// Phase 2A Forex Engines
import { ForexDemoProvider } from './src/markets/forex/provider';
import { ForexSignalEngine } from './src/markets/forex/signalEngine';
import { calculateIndicators } from './src/markets/forex/indicators';
import { analyzeMarketStructure } from './src/markets/forex/marketStructure';
import { calculateSupportResistance } from './src/markets/forex/supportResistance';
import { analyzeMultiTimeframe } from './src/markets/forex/multiTimeframe';
import { paperSignalTracker } from './src/markets/forex/paperTracker';
import { explainForexAnalysis } from './src/services/geminiExplainer';
import { ForexTimeframe } from './src/markets/forex/types';

// Phase 2B Broker Integration
import { BrokerError } from './src/brokers/errors';
import { brokerRouter } from './src/brokers/brokerRoutes';
import { LIVE_AUTO_EXECUTION_ALLOWED } from './src/brokers/safety/AutoExecutionEngine';

// Phase 3 Machine Learning Engine is retained for internal model compatibility;
// the public research/training API is retired while the research program is closed.

// Phase 5 Governance Engine
import { governanceRouter } from './src/governance/governanceRoutes';
import { reconciliationService } from './src/services/reconciliationService';
import { reconcileInFlightExecutionIntents } from './src/services/executionReconciliationService';

// Legacy demo execution is retired; LIVE_ONLY production mode is enforced by the server safety layer.
import { brokerRegistry } from './src/brokers/registry';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
let databaseReady = false;

function productionPreflight(enforce = false): { ok: boolean; checks: Record<string, string> } {
  const checks: Record<string, string> = {};
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
  checks.autonomousExecution = LIVE_AUTO_EXECUTION_ALLOWED === false ? 'DISABLED' : 'INVALID';
  checks.tradingMode = getSystemConfig().tradingMode;
  const ok = Boolean(operatorKey) && (ctraderConfigured || fivePaisaConfigured) && LIVE_AUTO_EXECUTION_ALLOWED === false && getSystemConfig().tradingMode === 'LIVE_ONLY';
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

// Operator authentication is a same-origin, HttpOnly session derived from the
// server-side operator API key. The secret is never embedded in the client bundle.
app.get('/api/operator/session', (req: Request, res: Response) => {
  res.json({
    configured: operatorAuthConfigured(),
    authenticated: isOperatorSessionValid(req),
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


const forexProviderV2 = new ForexDemoProvider();
const forexSignalEngine = new ForexSignalEngine(undefined, forexProviderV2);

const forexProvider = new LegacyForexProvider();
const indiaProvider = new IndianMarketDemoProvider();
const optionsProvider = new OptionsChainDemoProvider();
const economicProvider = new EconomicCalendarDemoProvider();
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

// Initialize database on boot
getDatabase().then(async () => {
  const rows = await executeQuery<any>('SELECT key, value FROM system_settings WHERE key IN (?, ?)', ['MAX_TRADE_VALUE_FOREX_USD', 'MAX_TRADE_VALUE_INDIAN_INR']);
  const persistedLimits: Record<string, number> = {};
  for (const row of rows) {
    const value = Number(row.value);
    if (Number.isFinite(value) && value > 0) persistedLimits[String(row.key)] = value;
  }
  const persistedUpdates: any = {};
  if (persistedLimits.MAX_TRADE_VALUE_FOREX_USD !== undefined) persistedUpdates.maxTradeValueForexUsd = persistedLimits.MAX_TRADE_VALUE_FOREX_USD;
  if (persistedLimits.MAX_TRADE_VALUE_INDIAN_INR !== undefined) persistedUpdates.maxTradeValueIndianInr = persistedLimits.MAX_TRADE_VALUE_INDIAN_INR;
  if (Object.keys(persistedUpdates).length) updateSystemConfig(persistedUpdates);
  databaseReady = true;
  console.log('SQLite database initialized successfully');
}).catch(err => {
  console.error('Failed to initialize SQLite database:', err);
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
    isDemo: false,
    timestamp: Date.now()
  });
});

// 2. Configuration API
app.get('/api/config', (req: Request, res: Response) => {
  res.json(getSystemConfig());
});

app.post('/api/config', operatorAuthRequired, async (req: Request, res: Response) => {
  try {
    const requestedForex = req.body?.maxTradeValueForexUsd;
    const requestedIndian = req.body?.maxTradeValueIndianInr;
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

    const updated = updateSystemConfig(updates);
    const now = Date.now();
    await executeRun(
      'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?), (?, ?, ?)',
      ['MAX_TRADE_VALUE_FOREX_USD', String(updated.maxTradeValueForexUsd), now, 'MAX_TRADE_VALUE_INDIAN_INR', String(updated.maxTradeValueIndianInr), now]
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
app.get('/api/forex/pairs', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    const instruments = await adapter.getInstruments();
    const pairsWithQuotes = await Promise.all(instruments.map(async inst => {
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
    }));
    return res.json(pairsWithQuotes);
  } catch (err: any) {
    return res.status(503).json({
      error: err?.code || 'LIVE_MARKET_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative cTrader market data is unavailable.'
    });
  }
});

app.get('/api/forex/market-status', (req: Request, res: Response) => {
  const status = forexProviderV2.getMarketStatus();
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
    const signal = await forexSignalEngine.generateSignal(pair);
    res.json(signal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/forex/signal/generate', async (req: Request, res: Response) => {
  try {
    const pair = extractForexPair(req);
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

// Paper Signal Tracking Endpoints (Section 25)
app.get('/api/forex/paper/tracked', async (req: Request, res: Response) => {
  try {
    const tracked = await paperSignalTracker.getAllTracked();
    res.json(tracked);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/forex/paper/track', async (req: Request, res: Response) => {
  try {
    let signal = req.body?.signal;
    if (!signal && req.body?.pair) {
      signal = await forexSignalEngine.generateSignal(req.body.pair);
    }
    if (!signal) {
      return res.status(400).json({ error: 'Valid signal payload or pair required' });
    }
    const currentPrice = req.body.currentPrice ?? signal.tradePlan?.entryPreferred ?? 1.0;
    const tracked = await paperSignalTracker.trackSignal(signal, currentPrice);
    res.json(tracked);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/forex/paper/update', async (req: Request, res: Response) => {
  try {
    const { trackId, currentPrice } = req.body;
    if (!trackId || currentPrice === undefined) {
      return res.status(400).json({ error: 'trackId and currentPrice are required' });
    }
    const updated = await paperSignalTracker.updatePrice(trackId, currentPrice);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Paper Portfolio & Trade API Endpoints
app.get('/api/paper/portfolio', async (req: Request, res: Response) => {
  try {
    const rows = await executeQuery<any>('SELECT balance, equity, margin_used, free_margin, currency FROM portfolio WHERE id = ?', ['paper_account']);
    if (rows.length) {
      res.json({
        balance: Number(rows[0].balance),
        equity: Number(rows[0].equity),
        marginUsed: Number(rows[0].margin_used),
        freeMargin: Number(rows[0].free_margin),
        currency: String(rows[0].currency),
        updatedAt: Date.now()
      });
    } else {
      res.json({
        balance: 100000,
        equity: 100000,
        marginUsed: 0,
        freeMargin: 100000,
        currency: 'USD',
        updatedAt: Date.now()
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paper/portfolio/reset', async (req: Request, res: Response) => {
  try {
    await executeRun(
      'UPDATE portfolio SET balance = 100000, equity = 100000, margin_used = 0, free_margin = 100000, currency = ? WHERE id = ?',
      ['USD', 'paper_account']
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/paper/trades', async (req: Request, res: Response) => {
  try {
    const rows = await executeQuery<any>(
      'SELECT id, instrument AS symbol, instrument, direction, entry_price, exit_price, size AS quantity, stop_loss, take_profit, pnl, status, entry_time, exit_time FROM trades ORDER BY entry_time DESC'
    );
    const trades = rows.map(r => ({
      id: r.id,
      symbol: r.symbol,
      market: 'LOCAL',
      type: r.direction,
      entryPrice: Number(r.entry_price),
      exitPrice: r.exit_price == null ? undefined : Number(r.exit_price),
      quantity: Number(r.quantity),
      stopLoss: Number(r.stop_loss || 0),
      takeProfit: Number(r.take_profit || 0),
      pnl: Number(r.pnl || 0),
      status: r.status === 'OPEN' ? 'OPEN' : 'CLOSED',
      openedAt: Number(r.entry_time),
      closedAt: r.exit_time == null ? undefined : Number(r.exit_time)
    }));
    res.json(trades);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paper/trades', async (req: Request, res: Response) => {
  try {
    const trade = req.body;
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await executeRun(
      'INSERT INTO trades (id, signal_id, instrument, direction, entry_price, size, status, entry_time, pnl) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0)',
      [id, trade.symbol, trade.type, trade.entryPrice, trade.quantity, 'OPEN', Date.now()]
    );
    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paper/trades/close', async (req: Request, res: Response) => {
  try {
    const { tradeId, exitPrice, pnl } = req.body;
    await executeRun(
      'UPDATE trades SET status = ?, exit_price = ?, pnl = ?, exit_time = ? WHERE id = ?',
      ['CLOSED', exitPrice, pnl, Date.now(), tradeId]
    );
    res.json({ success: true });
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
app.get('/api/india/underlyings', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.fetchIndianUnderlyingsFrom5Paisa !== 'function') {
      throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa underlying market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
    }
    res.json(await adapter.fetchIndianUnderlyingsFrom5Paisa());
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
    if (isForex) {
      const tf = (req.query.tf as ForexTimeframe) || '15M';
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 10), 500) : 80;
      const candles = await getLiveAnchoredCandles(symbol, tf, limit);
      return res.json(candles);
    } else {
      const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE');
      if (!adapter.getHistoricalCandles) throw new BrokerError('UNAVAILABLE', 'Authoritative 5paisa historical market-data capability is unavailable.', 'FIVE_PAISA', 'LIVE');
      const tf = String(req.query.tf || '15m');
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 10), 500) : 80;
      const candles = await adapter.getHistoricalCandles(symbol, tf, limit);
      return res.json(candles);
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
  const result = scannerService.getOptionsScanner(symbol);
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
app.get(['/api/signals', '/api/signals/all'], (req: Request, res: Response) => {
  const signals = scannerService.getAllSignals();
  res.json(signals);
});

// 8. Macroeconomic Events
app.get('/api/economic-events', (req: Request, res: Response) => {
  res.json(economicProvider.getEvents());
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
  productionPreflight(true);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, host, () => {
    console.log(`Goldcrest server listening on http://${host}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
    void captureLiveBrokerReconciliation();
    void reconcileInFlightExecutionIntents();
    const reconciliationTimer = setInterval(() => void captureLiveBrokerReconciliation(), 5 * 60_000);
    const executionLifecycleTimer = setInterval(() => void reconcileInFlightExecutionIntents(), 15_000);
    reconciliationTimer.unref?.();
    executionLifecycleTimer.unref?.();
  });

  const shutdown = (signal: string) => {
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
