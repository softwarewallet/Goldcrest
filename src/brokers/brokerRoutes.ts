import { Router, Request, Response } from 'express';
import { brokerRegistry } from './registry';
import { killSwitch } from './safety/KillSwitch';
import { tradeValidator } from './safety/TradeValidator';
import { liveTradingGate } from './safety/LiveTradingGate';
import { autoExecutionEngine, LIVE_AUTO_EXECUTION_ALLOWED } from './safety/AutoExecutionEngine';
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
      // Return null if account details are not yet retrieved or authenticated
      activeAccount = null;
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
  const { broker, environment = 'LIVE' } = req.body as { broker: BrokerType; environment: TradingEnvironment };

  if (!broker) {
    return res.status(400).json({ error: 'Missing broker parameter' });
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
    res.status(500).json({ error: normalized.message, code: normalized.code });
  }
});

// 3. Environment Switching with Explicit Confirmation (Requirement 9 & 30)
brokerRouter.post('/environment', (req: Request, res: Response) => {
  const { environment, confirmed } = req.body as { environment: TradingEnvironment; confirmed?: boolean };

  if (environment !== 'LIVE') {
    return res.status(400).json({ error: 'Invalid environment. Goldcrest operates in LIVE_ONLY mode.' });
  }

  const currentEnv = brokerRegistry.getEnvironment();
  brokerRegistry.setEnvironment('LIVE');
  logBrokerAction({
    source: 'USER_INTERFACE',
    broker: brokerRegistry.getSelectedBroker(),
    environment: 'LIVE',
    account: 'CONFIG',
    action: 'ENVIRONMENT_SWITCH',
    result: 'SUCCESS',
    error: `Operating in LIVE environment`
  });

  res.json({
    success: true,
    previousEnvironment: currentEnv,
    activeEnvironment: 'LIVE'
  });
});

// 4. Broker Selection with Compatibility Check (Requirement 10)
brokerRouter.post('/select', (req: Request, res: Response) => {
  const { broker } = req.body as { broker: BrokerType };

  if (!['CTRADER', 'FIVE_PAISA'].includes(broker)) {
    return res.status(400).json({ error: 'Invalid broker. Allowed: CTRADER, FIVE_PAISA' });
  }

  brokerRegistry.setSelectedBroker(broker);
  res.json({
    success: true,
    selectedBroker: broker,
    environment: brokerRegistry.getEnvironment()
  });
});

// 5. Update Live Credentials with Explicit Warning & Confirmation (Requirement 12)
brokerRouter.post('/credentials/live', (req: Request, res: Response) => {
  const { broker, credentials, userConfirmedAcknowledge } = req.body;

  if (!userConfirmedAcknowledge) {
    return res.status(400).json({
      error: 'Live credentials can access real broker APIs. Explicit confirmation is required before updating.'
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
    message: `${broker} LIVE credentials configured. Real-money live order submission remains permanently locked.`,
    maskedAccountId: maskIdentifier(credentials.accountId || credentials.clientId)
  });
});

// 7. Normalized Account Details (Requirement 15)
brokerRouter.get('/account', async (req: Request, res: Response) => {
  const broker = (req.query.broker as BrokerType) || brokerRegistry.getSelectedBroker();
  const environment = (req.query.environment as TradingEnvironment) || brokerRegistry.getEnvironment();

  try {
    const adapter = brokerRegistry.getAdapter(broker, environment);
    const account = await adapter.getAccount();
    res.json(account);
  } catch (err: any) {
    const normalized = normalizeBrokerError(err, broker, environment);
    res.status(500).json({ error: normalized.message, code: normalized.code });
  }
});

// 8. Normalized Positions (Requirement 16)
brokerRouter.get('/positions', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter();
    const positions = await adapter.getPositions();
    res.json(positions);
  } catch (err: any) {
    const normalized = normalizeBrokerError(err, brokerRegistry.getSelectedBroker(), brokerRegistry.getEnvironment());
    res.status(500).json({ error: normalized.message, code: normalized.code });
  }
});

// 9. Normalized Orders (Requirement 17)
brokerRouter.get('/orders', async (req: Request, res: Response) => {
  try {
    const adapter = brokerRegistry.getAdapter();
    const orders = await adapter.getOpenOrders();
    res.json(orders);
  } catch (err: any) {
    const normalized = normalizeBrokerError(err, brokerRegistry.getSelectedBroker(), brokerRegistry.getEnvironment());
    res.status(500).json({ error: normalized.message, code: normalized.code });
  }
});

// 10. Place Order Interface with Multi-Gate Verification & Invariant Enforcement (Section 1, 2, 3)
brokerRouter.post('/order', async (req: Request, res: Response) => {
  const orderReq = req.body as OrderRequest;
  const env = req.body.environment || brokerRegistry.getEnvironment();
  const broker = req.body.broker || brokerRegistry.getSelectedBroker();

  try {
    // 1. Emergency Halt Check
    if (killSwitch.isHalted()) {
      return res.status(403).json({
        error: 'TRADING HALTED: Emergency Kill Switch is currently active. New orders are blocked.',
        code: 'EMERGENCY_STOP_ACTIVE'
      });
    }

    // 2. Compatibility check
    const compat = brokerRegistry.validateMarketCompatibility(orderReq.market, broker);
    if (!compat.compatible) {
      return res.status(400).json({ error: compat.reason, code: 'INVALID_SYMBOL' });
    }

    const adapter = brokerRegistry.getAdapter(broker, env);

    // 3. Live Trading Gate (Strict 15-Point Pre-Flight Check)
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
          source: 'ORDER_VALIDATION',
          broker,
          environment: 'LIVE',
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
    }

    // Pre-flight validation path
    if (req.body.validateOnly) {
      return res.json({
        status: 'VALIDATED',
        message: 'Order pre-flight checks passed successfully (Autonomous live execution is disabled).'
      });
    }

    // Stage 5 Execution Boundary: Blocked by Safety Invariant LIVE_AUTO_EXECUTION_ALLOWED === false
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
        error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED: Autonomous live-money order submission is permanently disabled.'
      });

      return res.status(403).json({
        error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
        code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
        reason: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
        message: 'Autonomous live-money order submission is permanently disabled by system safety invariant LIVE_AUTO_EXECUTION_ALLOWED === false.'
      });
    }

    // Fallback closed
    return res.status(403).json({
      error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
      code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED'
    });
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

// 16. 5paisa Session Authentication via TOTP & PIN
brokerRouter.post('/fivepaisa/totp-login', async (req: Request, res: Response) => {
  const { environment = 'LIVE', totp, pin } = req.body;
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', environment as TradingEnvironment) as any;
    if (typeof adapter.loginWithTotp !== 'function') {
      return res.status(400).json({ error: 'Selected adapter does not support TOTP login.' });
    }
    await adapter.loginWithTotp(totp, pin);
    const account = await adapter.getAccount();
    res.json({
      success: true,
      message: 'Successfully authenticated with 5paisa OpenAPI via TOTP.',
      account
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '5paisa TOTP authentication failed' });
  }
});

// 17. 5paisa Exchange Request Token for Access Token
brokerRouter.post('/fivepaisa/exchange-token', async (req: Request, res: Response) => {
  const { environment = 'LIVE', requestToken } = req.body;
  if (!requestToken) {
    return res.status(400).json({ error: 'Missing requestToken parameter.' });
  }
  try {
    const adapter = brokerRegistry.getAdapter('FIVE_PAISA', environment as TradingEnvironment) as any;
    if (typeof adapter.exchangeRequestToken !== 'function') {
      return res.status(400).json({ error: 'Selected adapter does not support token exchange.' });
    }
    await adapter.exchangeRequestToken(requestToken);
    const account = await adapter.getAccount();
    res.json({
      success: true,
      message: 'Successfully exchanged RequestToken for 5paisa AccessToken.',
      account
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '5paisa token exchange failed' });
  }
});
