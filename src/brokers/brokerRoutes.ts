import { Router, Request, Response } from 'express';
import { brokerRegistry } from './registry';
import { killSwitch } from './safety/KillSwitch';
import { liveTradingGate } from './safety/LiveTradingGate';
import { autoExecutionEngine, LIVE_AUTO_EXECUTION_ALLOWED } from './safety/AutoExecutionEngine';
import { getAuditLogs, logBrokerAction, maskIdentifier } from './auditLog';
import { BrokerType, TradingEnvironment, OrderRequest } from './types';
import { normalizeBrokerError } from './errors';
import { reconciliationService } from '../services/reconciliationService';

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
    message: `${broker} LIVE credentials configured. Real-money autonomous order submission remains permanently locked.`,
    maskedAccountId: maskIdentifier(credentials.accountId || credentials.clientId)
  });
});

brokerRouter.get('/account', async (req: Request, res: Response) => {
  const requestedBroker = req.query.broker as BrokerType | undefined;

  try {
    if (requestedBroker) {
      const account = await brokerRegistry.getAdapter(requestedBroker, 'LIVE').getAccount();
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

    const gateResult = await liveTradingGate.evaluate(adapter, {
      order: orderReq,
      signalAgeMs: 15000,
      currentQuote: await adapter.getQuote(orderReq.symbol),
      isMarketOpen: true,
      dailyRealizedLoss: 0,
      dailyLossLimit: 5000,
      totalAccountExposure: 10000,
      maxAllowedExposure: 50000,
      activePositionsCount: (await adapter.getPositions()).length,
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
        message: 'Order pre-flight checks passed. Autonomous live execution remains disabled.'
      });
    }

    if (!LIVE_AUTO_EXECUTION_ALLOWED) {
      logBrokerAction({
        source: 'DISPATCH_BOUNDARY',
        broker,
        environment: env,
        account: 'LIVE_ACCOUNT',
        action: 'PLACE_ORDER',
        symbol: orderReq.symbol,
        quantity: orderReq.quantity,
        result: 'BLOCKED',
        error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED'
      });

      return res.status(403).json({
        error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
        code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
        reason: 'Autonomous live-money order submission is permanently disabled by system safety invariant LIVE_AUTO_EXECUTION_ALLOWED === false.'
      });
    }

    return res.status(403).json({
      error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
      code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED'
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
    return res.json({ status: 'TRADING HALTED', isHalted: true, cancelledOrders: result.cancelledCount });
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
  const broker = req.body?.broker as BrokerType | undefined;
  const brokers = broker ? [broker] : LIVE_BROKERS;
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
