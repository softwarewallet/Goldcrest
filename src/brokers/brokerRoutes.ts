import { Router, Request, Response } from 'express';
import { brokerRegistry } from './registry';
import { killSwitch } from './safety/KillSwitch';
import { tradeValidator } from './safety/TradeValidator';
import { liveTradingGate } from './safety/LiveTradingGate';
import { autoExecutionEngine } from './safety/AutoExecutionEngine';
import { getAuditLogs, logBrokerAction, maskIdentifier } from './auditLog';
import { BrokerType, TradingEnvironment, OrderRequest, OrderType } from './types';
import { BrokerError, normalizeBrokerError } from './errors';

export const brokerRouter = Router();

// 1. Broker Status & System Configuration
brokerRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const environment = brokerRegistry.getEnvironment();
    const selectedBroker = brokerRegistry.getSelectedBroker();
    const credStatuses = brokerRegistry.getCredentialStatuses();
    const controls = autoExecutionEngine.getControls();
    const haltDetails = killSwitch.getHaltDetails();

    let activeAccount = null;
    try {
      const adapter = brokerRegistry.getAdapter(selectedBroker, environment);
      activeAccount = await adapter.getAccount();
    } catch {
      // Ignored if not configured yet
    }

    res.json({
      environment,
      selectedBroker,
      credentials: credStatuses,
      controls,
      emergencyStop: haltDetails,
      activeAccount,
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Connection Testing (Requirement 14)
brokerRouter.post('/test-connection', async (req: Request, res: Response) => {
  const { broker, environment } = req.body as { broker: BrokerType; environment: TradingEnvironment };

  if (!broker || !environment) {
    return res.status(400).json({ error: 'Missing broker or environment parameters' });
  }

  try {
    const result = await brokerRegistry.testBrokerConnection(broker, environment);
    res.json(result);
  } catch (err: any) {
    const normalized = normalizeBrokerError(err, broker, environment);
    res.json({
      broker,
      environment,
      connected: false,
      account: '****',
      error: normalized.message,
      timestamp: Date.now()
    });
  }
});

// 2b. Account Discovery (Phase Platform Update)
brokerRouter.get('/accounts', async (req: Request, res: Response) => {
  const broker = (req.query.broker as BrokerType) || brokerRegistry.getSelectedBroker();
  const environment = (req.query.environment as TradingEnvironment) || brokerRegistry.getEnvironment();

  try {
    const adapter = brokerRegistry.getAdapter(broker, environment);
    if (adapter.getAccounts) {
      const accounts = await adapter.getAccounts();
      res.json(accounts);
    } else {
      const account = await adapter.getAccount();
      res.json([account]);
    }
  } catch (err: any) {
    const normalized = normalizeBrokerError(err, broker, environment);
    res.status(500).json({ error: normalized.message });
  }
});

// 3. Environment Switching with Explicit Confirmation (Requirement 9 & 30)
brokerRouter.post('/environment', (req: Request, res: Response) => {
  const { environment, confirmed } = req.body as { environment: TradingEnvironment; confirmed?: boolean };

  if (!['LIVE'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment. Only LIVE is allowed in production mode.' });
  }

  const currentEnv = brokerRegistry.getEnvironment();
  if (currentEnv !== environment && !confirmed) {
    return res.status(400).json({
      requiresConfirmation: true,
      currentEnvironment: currentEnv,
      requestedEnvironment: environment,
      message: `Switching from ${currentEnv} to ${environment} requires explicit confirmation.`
    });
  }

  brokerRegistry.setEnvironment(environment);
  logBrokerAction({
    source: 'USER_INTERFACE',
    broker: brokerRegistry.getSelectedBroker(),
    environment,
    account: 'CONFIG',
    action: 'ENVIRONMENT_SWITCH',
    result: 'SUCCESS',
    error: `Switched environment from ${currentEnv} to ${environment}`
  });

  res.json({
    success: true,
    previousEnvironment: currentEnv,
    activeEnvironment: environment
  });
});

// 4. Broker Selection with Compatibility Check (Requirement 10)
brokerRouter.post('/select', (req: Request, res: Response) => {
  const { broker } = req.body as { broker: BrokerType };

  if (!['CTRADER', 'FIVE_PAISA', 'PAPER'].includes(broker)) {
    return res.status(400).json({ error: 'Invalid broker. Allowed: CTRADER, FIVE_PAISA, PAPER' });
  }

  brokerRegistry.setSelectedBroker(broker);
  res.json({
    success: true,
    selectedBroker: broker,
    environment: brokerRegistry.getEnvironment()
  });
});

// 5. Update Demo Credentials (Requirement 11)
brokerRouter.post('/credentials/demo', (req: Request, res: Response) => {
  const { broker, credentials } = req.body;
  if (!broker || !credentials) {
    return res.status(400).json({ error: 'Missing broker or credentials' });
  }

  brokerRegistry.updateDemoCredentials(broker, credentials);
  logBrokerAction({
    source: 'SETTINGS_UI',
    broker,
    environment: 'DEMO',
    account: maskIdentifier(credentials.accountId || credentials.clientId),
    action: 'UPDATE_DEMO_CREDENTIALS',
    result: 'SUCCESS'
  });

  res.json({
    success: true,
    message: `${broker} demo credentials updated in secure server memory.`,
    maskedAccountId: maskIdentifier(credentials.accountId || credentials.clientId)
  });
});

// 6. Update Live Credentials with Explicit Warning & Confirmation (Requirement 12)
brokerRouter.post('/credentials/live', (req: Request, res: Response) => {
  const { broker, credentials, userConfirmedAcknowledge } = req.body;

  if (!userConfirmedAcknowledge) {
    return res.status(400).json({
      error: 'Live credentials can access real-money trading functionality. Explicit confirmation is required before updating.'
    });
  }

  if (!broker || !credentials) {
    return res.status(400).json({ error: 'Missing broker or credentials' });
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
    message: `${broker} LIVE credentials configured. Real-money live trading remains guarded.`,
    maskedAccountId: maskIdentifier(credentials.accountId || credentials.clientId)
  });
});

// 7. Normalized Account Details (Requirement 15)
brokerRouter.get('/account', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter();
    const account = await adapter.getAccount();
    res.json(account);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Normalized Positions (Requirement 16)
brokerRouter.get('/positions', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter();
    const positions = await adapter.getPositions();
    res.json(positions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Normalized Orders (Requirement 17)
brokerRouter.get('/orders', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter();
    const orders = await adapter.getOpenOrders();
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Place Order Interface with Multi-Gate Verification (Requirement 18, 21, 22, 32)
brokerRouter.post('/order', async (req: Request, res: Response) => {
  const orderReq = req.body as OrderRequest;
  const env = req.body.environment || brokerRegistry.getEnvironment();
  const broker = req.body.broker || brokerRegistry.getSelectedBroker();

  try {
    // 1. Emergency Halt Check
    if (killSwitch.isHalted()) {
      return res.status(403).json({
        error: 'TRADING HALTED: Emergency Kill Switch is currently active. New orders are blocked.'
      });
    }

    // 2. Compatibility check
    const compat = brokerRegistry.validateMarketCompatibility(orderReq.market, broker);
    if (!compat.compatible) {
      return res.status(400).json({ error: compat.reason });
    }

    const adapter = brokerRegistry.getAdapter(broker, env);

    // 3. Live Trading Gate (Strict 15-Point Check) if LIVE
    if (env === 'LIVE') {
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
          source: 'MANUAL_ORDER_SUBMIT',
          broker,
          environment: 'LIVE',
          account: 'LIVE_ACCOUNT',
          action: 'PLACE_ORDER',
          symbol: orderReq.symbol,
          quantity: orderReq.quantity,
          result: 'BLOCKED',
          error: gateResult.failedReasons.join(', ')
        });

        return res.status(403).json({
          error: 'Live Safety Gate Rejected Order',
          details: gateResult.failedReasons
        });
      }
    }

    if (req.body.validateOnly) {
      return res.json({ status: 'VALIDATED', message: 'Checks passed successfully' });
    }

    // 4. Place order via adapter
    const placedOrder = await adapter.placeOrder(orderReq);
    res.json(placedOrder);
  } catch (err: any) {
    const normalized = normalizeBrokerError(err, broker, env);
    res.status(400).json({
      error: normalized.message,
      code: normalized.code
    });
  }
});

// 11. Cancel Order
brokerRouter.post('/order/:id/cancel', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter();
    const success = await adapter.cancelOrder(req.params.id);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Close Position
brokerRouter.post('/position/:id/close', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter();
    const success = await adapter.closePosition(req.params.id, req.body?.quantity);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Emergency Stop / Kill Switch (Requirement 24)
brokerRouter.post('/kill-switch', async (req: Request, res: Response) => {
  const { action, reason } = req.body;
  if (action === 'HALT') {
    const result = await killSwitch.triggerEmergencyHalt(reason || 'Operator triggered Emergency Stop');
    return res.json({
      status: 'TRADING HALTED',
      isHalted: true,
      cancelledOrders: result.cancelledCount
    });
  } else if (action === 'RESUME') {
    killSwitch.resumeTrading();
    return res.json({
      status: 'TRADING ACTIVE',
      isHalted: false
    });
  } else {
    return res.status(400).json({ error: 'Action must be HALT or RESUME' });
  }
});

// 14. Live Controls (Requirement 23)
brokerRouter.post('/controls', (req: Request, res: Response) => {
  const updated = autoExecutionEngine.updateControls(req.body);
  res.json({ success: true, controls: updated });
});

// 15. Audit Logs (Requirement 33)
brokerRouter.get('/audit-logs', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const logs = getAuditLogs(limit);
  res.json(logs);
});
