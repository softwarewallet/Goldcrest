import { Router, Request, Response } from 'express';
import { brokerRegistry } from './registry';
import { killSwitch } from './safety/KillSwitch';
import { liveTradingGate } from './safety/LiveTradingGate';
import { autoExecutionEngine } from './safety/AutoExecutionEngine';
import { getAuditLogs, logBrokerAction, maskIdentifier } from './auditLog';
import { BrokerType, TradingEnvironment, OrderRequest } from './types';
import { normalizeBrokerError } from './errors';
import { reconciliationService } from '../services/reconciliationService';
import { getForexSessionState, getIndianSessionState } from '../markets/common/session';
import { claimExecutionIntent, completeExecutionIntent, failExecutionIntent, markExecutionIntentInFlight } from '../services/executionIntentService';
import { reconcileExecutionIntent } from '../services/executionReconciliationService';
import { getSystemConfig } from '../services/configService';

export const brokerRouter = Router();

const LIVE_BROKERS: BrokerType[] = ['CTRADER', 'FIVE_PAISA'];

function resolveMarketBroker(market: string): BrokerType {
  if (market === 'FOREX') return 'CTRADER';
  if (market === 'INDIAN_EQUITY' || market === 'INDIAN_FUTURES' || market === 'INDIAN_OPTIONS') {
    return 'FIVE_PAISA';
  }
  throw new Error(`Unsupported market: ${market}. No compatible live broker is configured.`);
}

// Both LIVE broker connections remain active simultaneously. No user broker
// selection is required; market compatibility determines the adapter.
brokerRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const environment = brokerRegistry.getEnvironment();
    const controls = autoExecutionEngine.getControls();
    const haltDetails = killSwitch.getHaltDetails();

    const brokerStatus = await Promise.all(LIVE_BROKERS.map(async (broker) => {
      try {
        const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
        const account = await adapter.getAccount();
        return { broker, environment: 'LIVE', connected: true, account, error: null };
      } catch (err: any) {
        const normalized = normalizeBrokerError(err, broker, 'LIVE');
        return {
          broker,
          environment: 'LIVE',
          connected: false,
          account: null,
          error: normalized.message,
          code: normalized.code
        };
      }
    }));

    res.json({
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
    });
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
    // Never substitute hard-coded or synthetic prices on an autonomous execution path.
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
    const currentExposure = positions.reduce((sum, position) => {
      const price = Number(position.currentPrice || position.entryPrice || 0);
      const quantity = Number(position.quantity || 0);
      return sum + (price > 0 && quantity > 0 ? price * quantity : 0);
    }, 0);
    const proposedReferencePrice = Number(orderReq.price || (orderReq.side === 'BUY' ? quote.ask : quote.bid) || 0);
    const proposedExposure = proposedReferencePrice > 0 && orderReq.quantity > 0
      ? proposedReferencePrice * Number(orderReq.quantity)
      : 0;
    const totalExposureIncludingOrder = currentExposure + proposedExposure;
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
      dailyRealizedLoss: adapter.broker === 'PAPER' ? 0 : await reconciliationService.getDailyLoss(adapter.broker as 'CTRADER' | 'FIVE_PAISA', Number(account.balance || 0)),
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
