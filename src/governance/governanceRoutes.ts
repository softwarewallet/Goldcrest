import { Router, Request, Response } from 'express';
import { brokerRegistry } from '../brokers/registry';
import { getAuditLogs, maskIdentifier } from '../brokers/auditLog';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { autoTradingService } from '../services/autoTradingService';
import { fetchLiveForexNews } from '../services/liveNewsService';

export const governanceRouter = Router();

const LIVE_BROKERS = ['CTRADER', 'FIVE_PAISA'] as const;

async function getLiveBrokerStatus() {
  return Promise.all(LIVE_BROKERS.map(async broker => {
    try {
      const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
      const account = await adapter.getAccount();
      const tradingStatus = await adapter.getTradingStatus();
      return {
        broker,
        environment: 'LIVE' as const,
        connected: true,
        tradingStatus,
        account,
        error: null
      };
    } catch (error: any) {
      return {
        broker,
        environment: 'LIVE' as const,
        connected: false,
        tradingStatus: 'ERROR',
        account: null,
        error: error?.message || String(error)
      };
    }
  }));
}

governanceRouter.get('/status', async (_req: Request, res: Response) => {
  const brokers = await getLiveBrokerStatus();
  res.json({
    environment: 'LIVE',
    tradingMode: 'LIVE',
    routingMode: 'AUTOMATIC_BY_MARKET',
    brokerRouting: {
      FOREX: 'CTRADER',
      INDIAN_EQUITY: 'FIVE_PAISA',
      INDIAN_FUTURES: 'FIVE_PAISA',
      INDIAN_OPTIONS: 'FIVE_PAISA'
    },
    brokers,
    killSwitch: killSwitch.getHaltDetails(),
    autoTrading: autoTradingService.getStatus(),
    timestamp: Date.now()
  });
});

governanceRouter.get('/audit-logs', (req: Request, res: Response) => {
  const limit = req.query.limit ? Math.max(1, Math.min(500, Number(req.query.limit))) : 100;
  const broker = typeof req.query.broker === 'string' ? req.query.broker as any : undefined;
  const logs = getAuditLogs(limit, {
    broker,
    environment: 'LIVE'
  });
  res.json(logs);
});

governanceRouter.get('/alerts', (req: Request, res: Response) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const logs = getAuditLogs(200, { environment: 'LIVE' });
  const alerts = logs
    .filter((log: any) => log.result === 'FAILURE' || log.result === 'BLOCKED')
    .map((log: any) => ({
      alertId: log.id,
      timestamp: log.timestamp,
      severity: log.result === 'FAILURE' ? 'CRITICAL' : 'WARNING',
      status: unreadOnly ? 'UNREAD' : 'ACTIVE',
      source: log.source,
      broker: log.broker,
      account: maskIdentifier(log.account),
      action: log.action,
      symbol: log.symbol,
      error: log.error,
      message: log.error || `${log.action} was ${String(log.result).toLowerCase()}.`
    }));
  res.json(alerts);
});

governanceRouter.post('/alerts/acknowledge', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'LIVE_ALERT_ACKNOWLEDGEMENT_UNSUPPORTED',
    message: 'Live broker audit alerts are immutable; acknowledgement state is not stored by Goldcrest.'
  });
});

governanceRouter.get('/reconciliation/positions', async (_req: Request, res: Response) => {
  try {
    const brokerResults = await Promise.all(LIVE_BROKERS.map(async broker => {
      const positions = await brokerRegistry.getAdapter(broker, 'LIVE').getPositions();
      return { broker, environment: 'LIVE', positions };
    }));
    res.json({
      environment: 'LIVE',
      generatedAt: Date.now(),
      brokers: brokerResults
    });
  } catch (error: any) {
    res.status(503).json({ error: 'LIVE_POSITION_RECONCILIATION_UNAVAILABLE', message: error?.message || String(error) });
  }
});

governanceRouter.post('/reconciliation/positions/run', async (_req: Request, res: Response) => {
  const brokerResults = await getLiveBrokerStatus();
  res.json({
    environment: 'LIVE',
    generatedAt: Date.now(),
    brokers: brokerResults.map(b => ({ broker: b.broker, status: b.connected ? 'AVAILABLE' : 'UNAVAILABLE' }))
  });
});

governanceRouter.get('/reconciliation/orders', async (_req: Request, res: Response) => {
  try {
    const brokerResults = await Promise.all(LIVE_BROKERS.map(async broker => {
      const orders = await brokerRegistry.getAdapter(broker, 'LIVE').getOpenOrders();
      return { broker, environment: 'LIVE', orders };
    }));
    res.json({
      environment: 'LIVE',
      generatedAt: Date.now(),
      brokers: brokerResults
    });
  } catch (error: any) {
    res.status(503).json({ error: 'LIVE_ORDER_RECONCILIATION_UNAVAILABLE', message: error?.message || String(error) });
  }
});

governanceRouter.post('/reconciliation/orders/run', async (_req: Request, res: Response) => {
  const brokerResults = await getLiveBrokerStatus();
  res.json({
    environment: 'LIVE',
    generatedAt: Date.now(),
    brokers: brokerResults.map(b => ({ broker: b.broker, status: b.connected ? 'AVAILABLE' : 'UNAVAILABLE' }))
  });
});

governanceRouter.get('/live-news', async (_req: Request, res: Response) => {
  const snapshot = await fetchLiveForexNews();
  res.json(snapshot);
});

const retired = (name: string) => (_req: Request, res: Response) => res.status(410).json({
  error: 'RETIRED_NON_LIVE_WORKFLOW',
  message: `${name} is retired. Goldcrest runs in LIVE_ONLY mode and exposes only authoritative live runtime data.`
});

for (const endpoint of [
  '/scorecard',
  '/strategies',
  '/models',
  '/promotions',
  '/promotions/generate-evidence',
  '/promotions/submit',
  '/promotions/approve',
  '/promotions/reject',
  '/evidence/:id',
  '/champion-challenger',
  '/shadow/predictions',
  '/shadow/record',
  '/funnel',
  '/rejections',
  '/execution-quality',
  '/demo-readiness',
  '/demo-test',
  '/demo-test/history',
  '/kill-switch-test',
  '/override',
  '/reports/daily',
  '/reports/weekly',
  '/run-tests',
  '/research/metrics',
  '/research/buckets',
  '/research/model-telemetry',
  '/research/experiments',
  '/research/experiments/create',
  '/data-quality',
  '/daily-summary',
  '/observation-session',
  '/accounting/consolidated-pnl',
  '/accounting/snapshots/create'
]) {
  governanceRouter.get(endpoint, retired(`GET ${endpoint}`));
  governanceRouter.post(endpoint, retired(`POST ${endpoint}`));
}

governanceRouter.get('/accounting/fx-rates', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'LIVE_ACCOUNTING_FX_ENDPOINT_RETIRED',
    message: 'Use live broker account data and broker-native currency reporting. Synthetic accounting fixtures are retired.'
  });
});

governanceRouter.get('/accounting/balances', async (_req: Request, res: Response) => {
  try {
    const accounts = (await getLiveBrokerStatus()).map(row => ({
      broker: row.broker,
      environment: 'LIVE',
      accountId: row.account?.accountId ? maskIdentifier(row.account.accountId) : null,
      accountType: 'LIVE',
      currency: row.account?.currency || null,
      balance: row.account?.balance ?? null,
      equity: row.account?.equity ?? null,
      availableMargin: row.account?.availableMargin ?? row.account?.freeMargin ?? null,
      connectionStatus: row.connected ? 'CONNECTED' : 'UNAVAILABLE'
    }));
    res.json({ accounts, environment: 'LIVE', generatedAt: Date.now() });
  } catch (error: any) {
    res.status(503).json({ error: 'LIVE_ACCOUNT_BALANCES_UNAVAILABLE', message: error?.message || String(error) });
  }
});

governanceRouter.get('/accounting/snapshots', (_req: Request, res: Response) => {
  res.json({
    environment: 'LIVE',
    snapshots: [],
    count: 0,
    message: 'Historical synthetic accounting snapshots are retired. Live broker snapshots are not fabricated.'
  });
});
