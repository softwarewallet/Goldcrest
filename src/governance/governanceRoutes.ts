import { Router, Request, Response } from 'express';
import { brokerRegistry } from '../brokers/registry';
import { getAuditLogs } from '../brokers/auditLog';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { autoTradingService } from '../services/autoTradingService';
import { reconciliationService } from '../services/reconciliationService';
import { FXRateProvider } from '../accounting';

export const governanceRouter = Router();

const LIVE_BROKERS = ['CTRADER', 'FIVE_PAISA'] as const;

governanceRouter.get('/status', async (_req: Request, res: Response) => {
  const emergency = killSwitch.getHaltDetails();
  const brokers = await Promise.all(LIVE_BROKERS.map(async broker => {
    try {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      const [account, tradingStatus] = await Promise.all([
        adapter.getAccount(),
        adapter.getTradingStatus()
      ]);
      return {
        broker,
        environment: 'LIVE',
        connected: true,
        tradingStatus,
        account,
        error: null
      };
    } catch (error: any) {
      return {
        broker,
        environment: 'LIVE',
        connected: false,
        tradingStatus: 'ERROR',
        account: null,
        error: error?.message || String(error)
      };
    }
  }));

  return res.json({
    environment: 'LIVE',
    routingMode: 'AUTOMATIC_BY_MARKET',
    brokerRouting: {
      FOREX: 'CTRADER',
      INDIAN_EQUITY: 'FIVE_PAISA',
      INDIAN_FUTURES: 'FIVE_PAISA',
      INDIAN_OPTIONS: 'FIVE_PAISA'
    },
    brokers,
    autoTrading: autoTradingService.getStatus(),
    emergencyStop: emergency,
    timestamp: Date.now()
  });
});

governanceRouter.get('/audit-logs', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
  const broker = req.query.broker as 'CTRADER' | 'FIVE_PAISA' | undefined;
  res.json(getAuditLogs(limit, broker ? { broker, environment: 'LIVE' } : { environment: 'LIVE' }));
});

async function reconcileLiveResource(resource: 'positions' | 'orders') {
  const rows: any[] = [];
  for (const broker of LIVE_BROKERS) {
    try {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      const values = resource === 'positions'
        ? await adapter.getPositions()
        : await adapter.getOpenOrders();
      rows.push({
        broker,
        environment: 'LIVE',
        brokerCount: values.length,
        internalCount: null,
        firestoreCount: null,
        status: 'SOURCE_COMPARISON_PENDING',
        details: 'Live broker state captured. Internal/cloud comparison is only reported when authoritative persisted state exists.'
      });
    } catch (error: any) {
      rows.push({
        broker,
        environment: 'LIVE',
        brokerCount: null,
        internalCount: null,
        firestoreCount: null,
        status: 'LIVE_SOURCE_UNAVAILABLE',
        details: error?.message || String(error)
      });
    }
  }
  return rows;
}

governanceRouter.get('/reconciliation/positions', async (_req: Request, res: Response) => {
  res.json(await reconcileLiveResource('positions'));
});

governanceRouter.get('/reconciliation/orders', async (_req: Request, res: Response) => {
  res.json(await reconcileLiveResource('orders'));
});

governanceRouter.get('/live-health', async (_req: Request, res: Response) => {
  const components = await Promise.all(LIVE_BROKERS.map(async broker => {
    const now = Date.now();
    try {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      const result = await adapter.testConnection();
      const tradingStatus = await adapter.getTradingStatus().catch(() => 'UNKNOWN');
      const healthy = result.connected && tradingStatus === 'CONNECTED';
      return {
        id: `${broker.toLowerCase()}_live_api`,
        name: broker === 'CTRADER' ? 'cTrader LIVE API' : '5paisa LIVE API',
        status: healthy ? 'HEALTHY' : result.connected ? 'DEGRADED' : 'ERROR',
        lastSuccessTimestamp: healthy ? Number(result.timestamp || now) : 0,
        latencyMs: Number(result.latency || 0),
        errorCount24h: undefined,
        requestCount24h: undefined,
        successCount24h: undefined,
        failedCount24h: undefined,
        timeoutCount24h: undefined,
        rateLimitEvents24h: undefined,
        currentFailureState: healthy ? undefined : String(result.error || `Trading status: ${tradingStatus}`)
      };
    } catch (error: any) {
      return {
        id: `${broker.toLowerCase()}_live_api`,
        name: broker === 'CTRADER' ? 'cTrader LIVE API' : '5paisa LIVE API',
        status: 'ERROR',
        lastSuccessTimestamp: 0,
        latencyMs: 0,
        errorCount24h: undefined,
        requestCount24h: undefined,
        successCount24h: undefined,
        failedCount24h: undefined,
        timeoutCount24h: undefined,
        rateLimitEvents24h: undefined,
        currentFailureState: error?.message || String(error)
      };
    }
  }));

  res.json({ environment: 'LIVE', components, timestamp: Date.now() });
});

governanceRouter.get('/accounting/fx-rates', (_req: Request, res: Response) => {
  const provider = FXRateProvider.getInstance();
  const usdInr = provider.getRate('USD', 'INR');
  const inrUsd = provider.getRate('INR', 'USD');
  res.json({
    environment: 'LIVE',
    timestamp: Date.now(),
    liveSourceStatus: provider.getLiveSourceStatus(),
    pairs: {
      USD_INR: usdInr,
      INR_USD: inrUsd
    }
  });
});

governanceRouter.get('/accounting/balances', async (_req: Request, res: Response) => {
  const accounts = [];
  for (const broker of LIVE_BROKERS) {
    try {
      const account = await brokerRegistry.getAdapter(broker, 'LIVE').getAccount();
      accounts.push({
        broker,
        environment: 'LIVE',
        accountId: account.accountId,
        currency: account.currency,
        balance: account.balance,
        equity: account.equity,
        availableMargin: account.availableMargin,
        usedMargin: account.usedMargin,
        isSimulatedCapital: false,
        lastUpdate: account.lastUpdate
      });
    } catch (error: any) {
      accounts.push({
        broker,
        environment: 'LIVE',
        accountId: null,
        currency: null,
        balance: null,
        equity: null,
        availableMargin: null,
        usedMargin: null,
        isSimulatedCapital: false,
        error: error?.message || String(error)
      });
    }
  }
  res.json({ environment: 'LIVE', accounts, timestamp: Date.now() });
});

governanceRouter.get('/reports/daily', async (_req: Request, res: Response) => {
  const status = autoTradingService.getStatus();
  const brokerStatus = await Promise.all(LIVE_BROKERS.map(async broker => {
    try {
      const account = await brokerRegistry.getAdapter(broker, 'LIVE').getAccount();
      return { broker, environment: 'LIVE', connected: true, balance: account.balance, equity: account.equity, currency: account.currency };
    } catch (error: any) {
      return { broker, environment: 'LIVE', connected: false, error: error?.message || String(error) };
    }
  }));
  res.json({
    reportDate: new Date().toISOString().slice(0, 10),
    environment: 'LIVE',
    autoTrading: status,
    brokers: brokerStatus,
    generatedAt: Date.now()
  });
});

governanceRouter.get('/reports/weekly', async (_req: Request, res: Response) => {
  const report = await reconciliationService.loadBrokerSnapshots(50);
  res.json({
    environment: 'LIVE',
    snapshotCount: report.length,
    snapshots: report,
    generatedAt: Date.now()
  });
});

// Research and non-live execution workflows were retired. These endpoints are intentionally unavailable.
governanceRouter.use(['/research', '/demo-readiness', '/demo-test', '/promotions', '/shadow'], (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'LIVE_ONLY',
    message: 'This workflow is retired. Goldcrest operates only with live broker data and live execution.'
  });
});
