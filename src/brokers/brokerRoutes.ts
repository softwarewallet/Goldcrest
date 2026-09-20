import { Router, Request, Response } from 'express';
import { brokerRegistry } from './registry';
import { killSwitch } from './safety/KillSwitch';
import { liveTradingGate } from './safety/LiveTradingGate';
import { autoExecutionEngine } from './safety/AutoExecutionEngine';
import { getAuditLogs, logBrokerAction, maskIdentifier } from './auditLog';
import { BrokerAdapter, BrokerType, NormalizedPosition, NormalizedQuote, TradingEnvironment, OrderRequest } from './types';
import { normalizeBrokerError } from './errors';
import { reconciliationService } from '../services/reconciliationService';
import { getForexSessionState, getIndianSessionState } from '../markets/common/session';
import { claimExecutionIntent, completeExecutionIntent, failExecutionIntent, markExecutionIntentInFlight, getExecutionIntent, resumeExecutionIntentReconciliation } from '../services/executionIntentService';
import { reconcileExecutionIntent } from '../services/executionReconciliationService';
import { getSystemConfig } from '../services/configService';
import { executeQuery, executeRun } from '../database/db';

export const brokerRouter = Router();

const LIVE_BROKERS: BrokerType[] = ['CTRADER', 'FIVE_PAISA'];

// Several terminal surfaces request broker status at nearly the same time.
// Share one short-lived broker snapshot and one in-flight request so normal
// UI polling does not repeatedly hit broker account APIs and trigger provider
// throttling. Order execution paths still request the broker directly.
const BROKER_STATUS_CACHE_TTL_MS = 60_000;
let brokerStatusCache: { payload: any; expiresAt: number } | null = null;
let brokerStatusInFlight: Promise<any> | null = null;

function resolveMarketBroker(market: string): BrokerType {
  if (market === 'FOREX') return 'CTRADER';
  if (market === 'INDIAN_EQUITY' || market === 'INDIAN_FUTURES' || market === 'INDIAN_OPTIONS') {
    return 'FIVE_PAISA';
  }
  throw new Error(`Unsupported market: ${market}. No compatible live broker is configured.`);
}

function forexQuoteCurrencies(symbol: string): { base: string; quote: string } | null {
  const compact = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (compact.length !== 6) return null;
  return { base: compact.slice(0, 3), quote: compact.slice(3, 6) };
}

async function convertForexNotionalToAccountCurrency(
  adapter: BrokerAdapter,
  symbol: string,
  notional: number,
  accountCurrency: string
): Promise<number> {
  if (!Number.isFinite(notional) || notional < 0) throw new Error('INVALID_EXPOSURE_NOTIONAL');
  const currencies = forexQuoteCurrencies(symbol);
  if (!currencies) throw new Error(`Unable to determine Forex currencies for ${symbol}.`);
  const target = String(accountCurrency || '').toUpperCase();
  if (!target) throw new Error('ACCOUNT_CURRENCY_UNAVAILABLE');
  if (currencies.base === target) return notional;

  // cTrader exposes an authoritative native conversion-chain API for cases
  // where no direct BASE/TARGET symbol exists. Do not fall back to guessed or
  // derived cross-pairs on a live safety-gate path.
  if (typeof adapter.getAccountCurrencyConversionRate !== 'function') {
    throw new Error('BROKER_NATIVE_CURRENCY_CONVERSION_UNAVAILABLE');
  }

  const rate = await adapter.getAccountCurrencyConversionRate(currencies.base, target);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Authoritative FX conversion returned an invalid rate for ${currencies.base} to ${target}.`);
  }
  return notional * rate;
}

async function calculateAccountCurrencyExposure(
  adapter: BrokerAdapter,
  positions: NormalizedPosition[],
  order: OrderRequest,
  accountCurrency: string,
  quote: NormalizedQuote
): Promise<number> {
  let exposure = 0;

  for (const position of positions) {
    const quantity = Math.abs(Number(position.quantity || 0));
    const price = Number(position.currentPrice || position.entryPrice || 0);
    if (!(quantity > 0 && price > 0)) continue;

    if (order.market !== 'FOREX') {
      exposure += quantity * price;
      continue;
    }

    const currencies = forexQuoteCurrencies(position.symbol);
    if (!currencies) throw new Error(`Unable to determine Forex currencies for ${position.symbol}.`);
    const baseNotional = quantity;
    exposure += await convertForexNotionalToAccountCurrency(adapter, position.symbol, baseNotional, accountCurrency);
  }

  const proposedQuantity = Math.abs(Number(order.quantity || 0));
  if (proposedQuantity > 0) {
    if (order.market !== 'FOREX') {
      exposure += proposedQuantity * Number(order.price || (order.side === 'BUY' ? quote.ask : quote.bid) || 0);
    } else {
      exposure += await convertForexNotionalToAccountCurrency(
        adapter,
        order.symbol,
        proposedQuantity,
        accountCurrency
      );
    }
  }

  return exposure;
}


async function loadPersistedBrokerAccount(broker: BrokerType): Promise<any | null> {
  try {
    const rows = await executeQuery<any>(
      'SELECT account_json FROM broker_reconciliation_snapshots WHERE broker = ? AND environment = ? ORDER BY timestamp DESC LIMIT 1',
      [broker, 'LIVE']
    );
    const snapshot = rows[0]?.account_json;
    if (!snapshot) return null;
    const account = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    return account && typeof account === 'object' ? account : null;
  } catch {
    try {
      const rows = await executeQuery<any>(
        'SELECT account_id, account_type, balance, equity, available_margin, used_margin, free_margin, currency, connection_status, server, permissions_json, last_update, is_live_account FROM broker_accounts WHERE broker = ? AND environment = ? ORDER BY last_update DESC LIMIT 1',
        [broker, 'LIVE']
      );
      const row = rows[0];
      if (!row) return null;
      return {
        accountId: String(row.account_id),
        accountType: String(row.account_type || 'LIVE'),
        balance: Number(row.balance || 0),
        equity: Number(row.equity || 0),
        availableMargin: Number(row.available_margin || 0),
        usedMargin: Number(row.used_margin || 0),
        freeMargin: Number(row.free_margin || 0),
        currency: String(row.currency || ''),
        broker,
        environment: 'LIVE',
        connectionStatus: 'CONNECTED',
        server: row.server || undefined,
        permissions: row.permissions_json ? JSON.parse(row.permissions_json) : [],
        lastUpdate: Number(row.last_update || 0),
        isLiveAccount: Boolean(row.is_live_account)
      };
    } catch {
      return null;
    }
  }
}

async function persistBrokerAccountSnapshot(account: any): Promise<void> {
  try {
    await executeRun(
      'INSERT OR REPLACE INTO broker_accounts (id, broker, environment, account_id, account_type, balance, equity, available_margin, used_margin, free_margin, currency, connection_status, server, permissions_json, last_update, is_live_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        `${account.broker}_${account.environment}_${account.accountId}`,
        account.broker,
        'LIVE',
        String(account.accountId || ''),
        String(account.accountType || 'LIVE'),
        Number(account.balance || 0),
        Number(account.equity || 0),
        Number(account.availableMargin || 0),
        Number(account.usedMargin || 0),
        Number(account.freeMargin || 0),
        String(account.currency || ''),
        String(account.connectionStatus || 'CONNECTED'),
        account.server || null,
        JSON.stringify(account.permissions || []),
        Number(account.lastUpdate || Date.now()),
        account.isLiveAccount ? 1 : 0
      ]
    );
  } catch {
    // Persistence failure must never break broker status delivery.
  }
}
async function getBrokerStatusSnapshot(): Promise<any> {
  const now = Date.now();
  if (brokerStatusCache && now < brokerStatusCache.expiresAt) {
    return brokerStatusCache.payload;
  }

  if (brokerStatusInFlight) {
    return brokerStatusInFlight;
  }

  brokerStatusInFlight = (async () => {
    const environment = brokerRegistry.getEnvironment();
    const controls = autoExecutionEngine.getControls();
    const haltDetails = killSwitch.getHaltDetails();

    const brokerStatus = await Promise.all(LIVE_BROKERS.map(async (broker) => {
      try {
        const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
        const account = await adapter.getAccount();
        await persistBrokerAccountSnapshot(account);
        return { broker, environment: 'LIVE', connected: true, account, error: null, stale: false };
      } catch (err: any) {
        const normalized = normalizeBrokerError(err, broker, 'LIVE');
        const transient = ['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'UNAVAILABLE', 'BROKER_UNAVAILABLE'].includes(normalized.code);
        const persisted = transient ? await loadPersistedBrokerAccount(broker) : null;

        if (persisted) {
          return {
            broker,
            environment: 'LIVE',
            connected: false,
            account: persisted,
            stale: true,
            lastRefreshError: normalized.message,
            error: null,
            code: normalized.code
          };
        }

        return {
          broker,
          environment: 'LIVE',
          connected: false,
          account: null,
          error: normalized.message,
          code: normalized.code,
          stale: false
        };
      }
    }));

    const payload = {
      environment,
      routingMode: 'AUTOMATIC_BY_MARKET',
      selectedBroker: null,
      brokerRouting: {
        FOREX: 'CTRADER',
        INDIAN_EQUITY: 'FIVE_PAISA',
        INDIAN_FUTURES: 'FIVE_PAISA',
        INDIAN_OPTIONS: 'FIVE_PAISA'
      },
      brokers: brokerStatus,
      credentials: brokerRegistry.getCredentialStatuses(),
      controls,
      emergencyStop: haltDetails,
      timestamp: Date.now()
    };

    brokerStatusCache = {
      payload,
      expiresAt: Date.now() + BROKER_STATUS_CACHE_TTL_MS
    };
    return payload;
  })().finally(() => {
    brokerStatusInFlight = null;
  });

  return brokerStatusInFlight;
}

brokerRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const payload = await getBrokerStatusSnapshot();
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.post('/test-connection', async (req: Request, res: Response) => {
  const requestedBroker = req.body?.broker as BrokerType | undefined;

  if (requestedBroker && !LIVE_BROKERS.includes(requestedBroker)) {
    return res.status(400).json({ error: 'Allowed live brokers: CTRADER, FIVE_PAISA' });
  }

  const brokers = requestedBroker ? [requestedBroker] : LIVE_BROKERS;
  const results = await Promise.all(brokers.map(async (broker) => {
    try {
      return await brokerRegistry.testBrokerConnection(broker, 'LIVE');
    } catch (err: any) {
      const normalized = normalizeBrokerError(err, broker, 'LIVE');
      return {
        broker,
        environment: 'LIVE',
        connected: false,
        account: '****',
        error: normalized.message,
        timestamp: Date.now()
      };
    }
  }));

  res.json({ routingMode: 'AUTOMATIC_BY_MARKET', results });
});

// Account discovery is broker-explicit for administrative diagnostics.
// Normal trading/dashboard flows use /status and aggregate both brokers.
brokerRouter.get('/accounts', async (req: Request, res: Response) => {
  const requestedBroker = req.query.broker as BrokerType | undefined;
  const brokers = requestedBroker ? [requestedBroker] : LIVE_BROKERS;

  try {
    const results = await Promise.all(brokers.map(async (broker) => {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      if (adapter.getAccounts) return adapter.getAccounts();
      return [await adapter.getAccount()];
    }));
    res.json(results.flat());
  } catch (err: any) {
    const broker = requestedBroker || 'CTRADER';
    const normalized = normalizeBrokerError(err, broker, 'LIVE');
    res.status(500).json({ error: normalized.message, code: normalized.code });
  }
});

brokerRouter.post('/environment', (_req: Request, res: Response) => {
  const currentEnv = brokerRegistry.getEnvironment();
  brokerRegistry.setEnvironment('LIVE');
  res.json({
    success: true,
    previousEnvironment: currentEnv,
    activeEnvironment: 'LIVE',
    routingMode: 'AUTOMATIC_BY_MARKET'
  });
});

// Legacy endpoint retained for compatibility. It no longer controls which
// broker is active; both live brokers remain active.
brokerRouter.post('/select', (req: Request, res: Response) => {
  const { broker } = req.body as { broker: BrokerType };

  if (!LIVE_BROKERS.includes(broker)) {
    return res.status(400).json({ error: 'Invalid broker. Allowed: CTRADER, FIVE_PAISA' });
  }

  res.json({
    success: true,
    selectedBroker: null,
    routingMode: 'AUTOMATIC_BY_MARKET',
    message: 'Manual broker selection is disabled. Goldcrest automatically routes each market to its compatible live broker.'
  });
});

brokerRouter.post('/credentials/live', (req: Request, res: Response) => {
  const { broker, credentials, userConfirmedAcknowledge } = req.body;

  if (!userConfirmedAcknowledge) {
    return res.status(400).json({
      error: 'Live credentials can access real broker APIs. Explicit confirmation is required before updating.'
    });
  }

  if (!LIVE_BROKERS.includes(broker)) {
    return res.status(400).json({ error: 'Missing or invalid broker. Allowed: CTRADER, FIVE_PAISA' });
  }

  if (!credentials) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  brokerRegistry.updateLiveCredentials(broker, credentials);
  logBrokerAction({
    source: 'SETTINGS_UI',
    broker,
    environment: 'LIVE',
    account: maskIdentifier(credentials.accountId || credentials.clientId),
    action: 'UPDATE_LIVE_CREDENTIALS',
    result: 'SUCCESS'
  });

  res.json({
    success: true,
    message: `${broker} LIVE credentials configured. Real-money autonomous order submission is enabled only when the server-side live safety gate passes.`,
    maskedAccountId: maskIdentifier(credentials.accountId || credentials.clientId)
  });
});

const DASHBOARD_SUMMARY_CACHE_TTL_MS = 30_000;
let dashboardSummaryCache: { payload: any; expiresAt: number } | null = null;
let dashboardSummaryInFlight: Promise<any> | null = null;

async function getDashboardSummarySnapshot(): Promise<any> {
  const now = Date.now();
  if (dashboardSummaryCache && now < dashboardSummaryCache.expiresAt) {
    return dashboardSummaryCache.payload;
  }
  if (dashboardSummaryInFlight) return dashboardSummaryInFlight;

  dashboardSummaryInFlight = (async () => {
    const results = await Promise.all(LIVE_BROKERS.map(async (broker) => {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      const [account, positions, openOrders, orderHistory] = await Promise.all([
        adapter.getAccount(),
        adapter.getPositions(),
        adapter.getOpenOrders(),
        adapter.getOrderHistory()
      ]);
      let dailyRealizedPnL: number | null = null;
      if (typeof adapter.getDailyRealizedPnL === 'function') {
        try { dailyRealizedPnL = await adapter.getDailyRealizedPnL(); } catch { dailyRealizedPnL = null; }
      }
      return { broker, account, positions, openOrders, orderHistory, dailyRealizedPnL };
    }));

    const accounts = results.map(r => r.account);
    const positions = results.flatMap(r => r.positions);
    const openOrders = results.flatMap(r => r.openOrders);
    const orderHistory = results.flatMap(r => r.orderHistory).sort((a, b) => b.timestamp - a.timestamp);
    const currencies = Array.from(new Set(accounts.map(a => String(a.currency || '').toUpperCase()).filter(Boolean)));
    const sameCurrency = currencies.length <= 1;
    const totalBalance = sameCurrency ? accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0) : null;
    const totalEquity = sameCurrency ? accounts.reduce((sum, a) => sum + Number(a.equity || 0), 0) : null;
    const totalFreeMargin = sameCurrency ? accounts.reduce((sum, a) => sum + Number(a.freeMargin || 0), 0) : null;
    const openPnL = positions.reduce((sum, p) => sum + Number(p.unrealizedPnL || 0), 0);
    const dailyRealizedPnLValues = results.map(r => r.dailyRealizedPnL).filter((v): v is number => Number.isFinite(v as number));
    const dailyRealizedPnL = dailyRealizedPnLValues.length
      ? dailyRealizedPnLValues.reduce((sum, v) => sum + v, 0)
      : null;
    const closedHistory = orderHistory.filter(o => ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(o.status));

    const payload = {
      accounts,
      positions,
      openOrders,
      orderHistory: orderHistory.slice(0, 100),
      brokerSummaries: results.map(r => ({
        broker: r.broker,
        account: r.account,
        dailyRealizedPnL: r.dailyRealizedPnL,
        positionsCount: r.positions.length,
        openOrdersCount: r.openOrders.length,
        orderHistory: r.orderHistory.slice(0, 50)
      })),
      metrics: {
        totalBalance,
        totalEquity,
        totalFreeMargin,
        currencies,
        openPnL,
        dailyRealizedPnL,
        totalOrders: closedHistory.length,
        winRate: null,
        profitFactor: null,
        maxDrawdown: null
      },
      dataStatus: 'LIVE',
      generatedAt: Date.now()
    };

    dashboardSummaryCache = {
      payload,
      expiresAt: Date.now() + DASHBOARD_SUMMARY_CACHE_TTL_MS
    };
    return payload;
  })().finally(() => {
    dashboardSummaryInFlight = null;
  });

  return dashboardSummaryInFlight;
}

brokerRouter.get('/dashboard-summary', async (_req: Request, res: Response) => {
  try {
    res.json(await getDashboardSummarySnapshot());
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_DASHBOARD_DATA_UNAVAILABLE',
      message: err?.message || 'Authoritative live broker dashboard data is unavailable.'
    });
  }
});

brokerRouter.get('/account', async (req: Request, res: Response) => {
  const requestedBroker = req.query.broker as BrokerType | undefined;

  try {
    if (requestedBroker) {
      const adapter = brokerRegistry.getAdapter(requestedBroker, 'LIVE');
      const tradingStatus = await adapter.getTradingStatus();
      console.log(`[DEBUG] Adapter for ${requestedBroker}:`, adapter?.broker, tradingStatus);
      const account = await adapter.getAccount();
      console.log(`[DEBUG] Account for ${requestedBroker}:`, JSON.stringify(account, null, 2));
      return res.json(account);
    }

    const accounts = await Promise.all(LIVE_BROKERS.map(async (broker) => {
      try {
        return await brokerRegistry.getAdapter(broker, 'LIVE').getAccount();
      } catch {
        return null;
      }
    }));

    res.json({
      routingMode: 'AUTOMATIC_BY_MARKET',
      accounts: accounts.filter(Boolean)
    });
  } catch (err: any) {
    const broker = requestedBroker || 'CTRADER';
    const normalized = normalizeBrokerError(err, broker, 'LIVE');
    const transient = ['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'UNAVAILABLE', 'BROKER_UNAVAILABLE'].includes(normalized.code);

    if (requestedBroker && transient) {
      const persisted = await loadPersistedBrokerAccount(requestedBroker);
      if (persisted) {
        return res.json({
          ...persisted,
          stale: true,
          lastRefreshError: normalized.message
        });
      }
    }

    res.status(500).json({ error: normalized.message, code: normalized.code });
  }
});

brokerRouter.get('/positions', async (_req: Request, res: Response) => {
  const results = await Promise.all(LIVE_BROKERS.map(async (broker) => {
    try {
      return await brokerRegistry.getAdapter(broker, 'LIVE').getPositions();
    } catch {
      return [];
    }
  }));
  res.json(results.flat());
});

brokerRouter.get('/order-history', async (req: Request, res: Response) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  const from = Number.isFinite(Number(req.query.from)) ? Number(req.query.from) : defaultFrom;
  const to = Number.isFinite(Number(req.query.to)) ? Number(req.query.to) : defaultTo;
  const direction = String(req.query.direction || 'ALL').toUpperCase();
  const requestedBroker = String(req.query.broker || '').toUpperCase();

  if (!(from >= 0 && to >= from)) {
    return res.status(400).json({ error: 'Invalid history date range.' });
  }
  if (direction !== 'ALL' && direction !== 'BUY' && direction !== 'SELL') {
    return res.status(400).json({ error: 'Direction must be ALL, BUY, or SELL.' });
  }
  if (requestedBroker && !LIVE_BROKERS.includes(requestedBroker as BrokerType)) {
    return res.status(400).json({ error: 'Broker must be CTRADER or FIVE_PAISA.' });
  }

  try {
    const brokers = requestedBroker
      ? [requestedBroker as BrokerType]
      : LIVE_BROKERS;

    const results = await Promise.all(brokers.map(async broker => {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      const history = adapter.getOrderHistoryRange
        ? await adapter.getOrderHistoryRange(from, to)
        : await adapter.getOrderHistory();

      return history
        .filter(order => Number(order.timestamp) >= from && Number(order.timestamp) <= to)
        .filter(order => direction === 'ALL' || order.side === direction)
        .map(order => {
          const closingPrice = Number(order.averageFillPrice ?? order.price ?? 0);
          const closingQuantity = Number(order.filledQuantity ?? order.quantity ?? 0);
          const closingVolume = closingPrice > 0 && closingQuantity > 0
            ? closingPrice * closingQuantity
            : null;

          return {
            id: order.id,
            broker: order.broker,
            environment: order.environment,
            symbol: order.symbol,
            openingDirection: order.side,
            closingTime: order.timestamp,
            entryPrice: Number(order.price ?? 0) || null,
            closingPrice: closingPrice > 0 ? closingPrice : null,
            closingQuantity: closingQuantity > 0 ? closingQuantity : null,
            closingVolume,
            swap: null,
            commission: Number(order.commission ?? 0) || null,
            netAmount: null,
            balance: null,
            orderStatus: order.status,
            brokerOrderId: order.brokerOrderId || null,
            signalId: order.signalId || null,
            strategyId: order.strategyId || null
          };
        });
    }));

    const rows = results.flat().sort((a, b) => Number(b.closingTime) - Number(a.closingTime));
    res.json({
      environment: 'LIVE',
      from,
      to,
      direction,
      rows,
      count: rows.length,
      sources: brokers
    });
  } catch (err: any) {
    res.status(503).json({
      error: 'LIVE_ORDER_HISTORY_UNAVAILABLE',
      message: err?.message || 'Authoritative live order history is unavailable.'
    });
  }
});

brokerRouter.get('/orders', async (_req: Request, res: Response) => {
  const results = await Promise.all(LIVE_BROKERS.map(async (broker) => {
    try {
      return await brokerRegistry.getAdapter(broker, 'LIVE').getOpenOrders();
    } catch {
      return [];
    }
  }));
  res.json(results.flat());
});

brokerRouter.get('/execution/:idempotencyKey', async (req: Request, res: Response) => {
  try {
    const key = String(req.params.idempotencyKey || '').trim();
    if (!key) return res.status(400).json({ error: 'Missing idempotency key.' });
    const intent = await getExecutionIntent(key);
    if (!intent) return res.status(404).json({ error: 'Execution intent not found.' });
    res.json({
      ...intent,
      operatorActionRequired: intent.state === 'RECONCILIATION_TIMEOUT' || Boolean((intent.result as any)?.operatorActionRequired),
      reconciliationState: (intent.result as any)?.reconciliationState || intent.state
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load execution intent.' });
  }
});

brokerRouter.post('/execution/:idempotencyKey/retry-reconciliation', async (req: Request, res: Response) => {
  try {
    const key = String(req.params.idempotencyKey || '').trim();
    if (!key) return res.status(400).json({ error: 'Missing idempotency key.' });
    const intent = await getExecutionIntent(key);
    if (!intent) return res.status(404).json({ error: 'Execution intent not found.' });
    if (intent.state !== 'RECONCILIATION_TIMEOUT') {
      return res.status(409).json({ error: 'Execution intent is not in RECONCILIATION_TIMEOUT state.', state: intent.state });
    }
    await resumeExecutionIntentReconciliation(key);
    void reconcileExecutionIntent(key);
    res.json({ success: true, idempotencyKey: key, state: 'IN_FLIGHT' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to resume reconciliation.' });
  }
});

brokerRouter.post('/order', async (req: Request, res: Response) => {
  const orderReq = req.body as OrderRequest;
  const env: TradingEnvironment = 'LIVE';

  try {
    if (!orderReq?.market || !orderReq?.symbol) {
      return res.status(400).json({ error: 'Missing market or symbol', code: 'INVALID_SYMBOL' });
    }

    const broker = resolveMarketBroker(orderReq.market);
    const adapter = brokerRegistry.getAdapterForMarket(orderReq.market);

    const compat = brokerRegistry.validateMarketCompatibility(orderReq.market, broker);
    if (!compat.compatible) {
      return res.status(400).json({ error: compat.reason, code: 'INVALID_SYMBOL' });
    }

    if (killSwitch.isHalted()) {
      return res.status(403).json({
        error: 'TRADING HALTED: Emergency Kill Switch is currently active. New orders are blocked.',
        code: 'EMERGENCY_STOP_ACTIVE'
      });
    }

    // Pre-flight check: a live order requires an authoritative, fresh broker quote.
    // Never substitute hard-coded or substitute prices on an autonomous execution path.
    let quote;
    try {
      quote = await adapter.getQuote(orderReq.symbol);
    } catch (err: any) {
      return res.status(503).json({
        error: `Authoritative live quote unavailable: ${err?.message || 'broker quote request failed'}`,
        code: 'LIVE_QUOTE_UNAVAILABLE'
      });
    }

    if (!quote || quote.bid <= 0 || quote.ask <= 0) {
      return res.status(400).json({ error: 'Authoritative real-time quote is currently unavailable.', code: 'STALE_DATA' });
    }

    // Auto-populate price for MARKET orders if missing
    if (!orderReq.price || orderReq.price <= 0) {
      orderReq.price = orderReq.side === 'BUY' ? quote.ask : quote.bid;
    }

    // Auto-populate Stop Loss (Check 9 Compliance) and Take Profit if missing or invalid
    if (!orderReq.stopLoss || orderReq.stopLoss <= 0) {
      const isForex = orderReq.market === 'FOREX';
      const referencePrice = orderReq.price;
      const pct = isForex ? 0.005 : 0.01; // 50 pips (0.5%) for Forex, 1.0% for others
      if (orderReq.side === 'BUY') {
        orderReq.stopLoss = Number((referencePrice * (1 - pct)).toFixed(isForex ? 5 : 2));
        if (!orderReq.takeProfit || orderReq.takeProfit <= 0) {
          orderReq.takeProfit = Number((referencePrice * (1 + pct * 2)).toFixed(isForex ? 5 : 2));
        }
      } else {
        orderReq.stopLoss = Number((referencePrice * (1 + pct)).toFixed(isForex ? 5 : 2));
        if (!orderReq.takeProfit || orderReq.takeProfit <= 0) {
          orderReq.takeProfit = Number((referencePrice * (1 - pct * 2)).toFixed(isForex ? 5 : 2));
        }
      }
    }

    const account = await adapter.getAccount();
    const positions = await adapter.getPositions();
    const isMarketOpen = orderReq.market === 'FOREX'
      ? !getForexSessionState().activeSessions.includes('CLOSED (WEEKEND)')
      : getIndianSessionState().isOpen;
    let totalExposureIncludingOrder: number;
    try {
      totalExposureIncludingOrder = await calculateAccountCurrencyExposure(
        adapter,
        positions,
        orderReq,
        account.currency,
        quote
      );
    } catch (exposureErr: any) {
      return res.status(403).json({
        error: 'Live Safety Gate Rejected Order',
        code: 'EXPOSURE_CURRENCY_UNAVAILABLE',
        details: [`Account-currency exposure could not be verified safely: ${exposureErr?.message || String(exposureErr)}`]
      });
    }
    const maxAllowedExposure = Math.max(Number(account.equity || 0), 1);
    const dailyLossLimit = Math.max(
      Number(account.balance || 0) * (Number(getSystemConfig().maxDailyLossPct) / 100),
      1
    );

    const gateResult = await liveTradingGate.evaluate(adapter, {
      order: orderReq,
      signalAgeMs: 15000,
      currentQuote: quote,
      isMarketOpen,
      dailyRealizedLoss: await reconciliationService.getDailyLoss(adapter.broker as 'CTRADER' | 'FIVE_PAISA', Number(account.balance || 0)),
      dailyLossLimit,
      totalAccountExposure: totalExposureIncludingOrder,
      maxAllowedExposure,
      activePositionsCount: positions.length,
      maxOpenPositions: 5
    });

    if (!gateResult.passed) {
      logBrokerAction({
        source: 'ORDER_VALIDATION',
        broker,
        environment: env,
        account: 'LIVE_ACCOUNT',
        action: 'VALIDATE_ORDER',
        symbol: orderReq.symbol,
        quantity: orderReq.quantity,
        result: 'BLOCKED',
        error: gateResult.failedReasons.join(', ')
      });

      return res.status(403).json({
        error: 'Live Safety Gate Rejected Order',
        code: 'SAFETY_GATE_REJECTED',
        details: gateResult.failedReasons
      });
    }

    if (req.body.validateOnly) {
      return res.json({
        status: 'VALIDATED',
        broker,
        market: orderReq.market,
        message: 'Order pre-flight checks passed. Live dispatch is permitted by the current server controls.'
      });
    }


    const idempotencyKey = String(
      req.header('X-Idempotency-Key') ||
      orderReq.signalId ||
      ''
    ).trim();

    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'Autonomous live orders require X-Idempotency-Key or signalId.',
        code: 'IDEMPOTENCY_KEY_REQUIRED'
      });
    }

    const intent = await claimExecutionIntent(idempotencyKey, {
      broker,
      market: orderReq.market,
      symbol: orderReq.symbol,
      side: orderReq.side,
      payload: orderReq
    });

    if (!intent.claimed) {
      if (intent.existing?.state === 'COMPLETED') {
        return res.json({
          status: 'DUPLICATE_REPLAY',
          broker,
          market: orderReq.market,
          order: intent.existing.result
        });
      }
      return res.status(409).json({
        error: 'An autonomous execution with this idempotency key is already pending or has failed.',
        code: 'EXECUTION_INTENT_ALREADY_EXISTS',
        state: intent.existing?.state
      });
    }

    let placedOrder;
    try {
      placedOrder = await adapter.placeOrder(orderReq);
    } catch (err: any) {
      await failExecutionIntent(idempotencyKey, {
        broker,
        market: orderReq.market,
        symbol: orderReq.symbol,
        submissionState: 'REJECTED_OR_FAILED',
        error: err?.message || String(err),
        code: err?.code || 'ORDER_REJECTED',
        failedAt: Date.now()
      });
      throw err;
    }

    if (placedOrder.status === 'FILLED') {
      await completeExecutionIntent(idempotencyKey, placedOrder);
      return res.json({
        status: 'EXECUTED',
        broker,
        market: orderReq.market,
        order: placedOrder
      });
    }

    await markExecutionIntentInFlight(idempotencyKey, placedOrder);

    // Never infer FILLED from submission acknowledgement. The broker remains
    // authoritative and the background reconciler will transition ACCEPTED /
    // PARTIALLY_FILLED to a terminal broker-confirmed state.
    void reconcileExecutionIntent(idempotencyKey);

    return res.json({
      status: placedOrder.status === 'PARTIALLY_FILLED' ? 'PARTIALLY_FILLED' : 'ACCEPTED',
      broker,
      market: orderReq.market,
      order: placedOrder,
      executionState: 'IN_FLIGHT'
    });
  } catch (err: any) {
    const broker = (() => {
      try { return resolveMarketBroker(orderReq?.market); } catch { return 'CTRADER' as BrokerType; }
    })();
    const normalized = normalizeBrokerError(err, broker, env);
    res.status(400).json({ error: normalized.message, code: normalized.code });
  }
});

brokerRouter.post('/order/:id/cancel', async (req: Request, res: Response) => {
  try {
    const broker = req.body?.broker as BrokerType | undefined;
    if (!broker || !LIVE_BROKERS.includes(broker)) {
      return res.status(400).json({ error: 'Broker is required for cancel operation: CTRADER or FIVE_PAISA' });
    }
    const success = await brokerRegistry.getAdapter(broker, 'LIVE').cancelOrder(req.params.id);
    res.json({ success, broker });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.post('/position/:id/close', async (req: Request, res: Response) => {
  try {
    const broker = req.body?.broker as BrokerType | undefined;
    if (!broker || !LIVE_BROKERS.includes(broker)) {
      return res.status(400).json({ error: 'Broker is required for close operation: CTRADER or FIVE_PAISA' });
    }
    const success = await brokerRegistry.getAdapter(broker, 'LIVE').closePosition(req.params.id, req.body?.quantity);
    res.json({ success, broker });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.post('/kill-switch', async (req: Request, res: Response) => {
  const { action, reason } = req.body;
  if (action === 'HALT') {
    const result = await killSwitch.triggerEmergencyHalt(reason || 'Operator triggered Emergency Stop');
    return res.json({
      status: 'TRADING HALTED',
      isHalted: true,
      cancelledOrders: result.cancelledCount,
      requestedCancellations: result.requestedCount,
      unconfirmedOpenOrders: result.unconfirmedCount,
      brokerResults: result.brokerResults
    });
  }
  if (action === 'RESUME') {
    killSwitch.resumeTrading();
    return res.json({ status: 'TRADING ACTIVE', isHalted: false });
  }
  return res.status(400).json({ error: 'Action must be HALT or RESUME' });
});

brokerRouter.post('/controls', (req: Request, res: Response) => {
  const updated = autoExecutionEngine.updateControls(req.body);
  res.json({ success: true, controls: updated });
});

brokerRouter.post('/reconciliation/snapshot', async (req: Request, res: Response) => {
  const broker = req.body?.broker as ('CTRADER' | 'FIVE_PAISA') | undefined;
  const brokers: ('CTRADER' | 'FIVE_PAISA')[] = broker ? [broker] : ['CTRADER', 'FIVE_PAISA'];
  if (brokers.some(b => !LIVE_BROKERS.includes(b))) {
    return res.status(400).json({ error: 'Allowed live brokers: CTRADER, FIVE_PAISA' });
  }
  try {
    const snapshots = await Promise.all(brokers.map(b => reconciliationService.captureBrokerSnapshot(b)));
    res.json({ success: true, snapshots });
  } catch (err: any) {
    res.status(502).json({ error: err.message, code: 'BROKER_RECONCILIATION_FAILED' });
  }
});

brokerRouter.get('/reconciliation/snapshots', async (req: Request, res: Response) => {
  const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 1), 500) : 50;
  try {
    res.json(await reconciliationService.loadBrokerSnapshots(limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokerRouter.get('/audit-logs', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json(getAuditLogs(limit));
});

brokerRouter.post('/fivepaisa/totp-login', async (req: Request, res: Response) => {
  const { totp, pin } = req.body;
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.loginWithTotp !== 'function') {
      return res.status(400).json({ error: 'Selected adapter does not support TOTP login.' });
    }
    await adapter.loginWithTotp(totp, pin);
    const account = await adapter.getAccount();
    res.json({ success: true, message: 'Successfully authenticated with 5paisa OpenAPI via TOTP.', account });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '5paisa TOTP authentication failed' });
  }
});

brokerRouter.post('/fivepaisa/exchange-token', async (req: Request, res: Response) => {
  const { requestToken } = req.body;
  if (!requestToken) {
    return res.status(400).json({ error: 'Missing requestToken parameter.' });
  }
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', 'LIVE') as any;
    if (typeof adapter.exchangeRequestToken !== 'function') {
      return res.status(400).json({ error: 'Selected adapter does not support token exchange.' });
    }
    await adapter.exchangeRequestToken(requestToken);
    const account = await adapter.getAccount();
    res.json({ success: true, message: 'Successfully exchanged RequestToken for 5paisa AccessToken.', account });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '5paisa token exchange failed' });
  }
});
