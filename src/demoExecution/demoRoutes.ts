// ============================================================================
// PHASE 6: DEMO EXECUTION EXPRESS ROUTER (/api/demo/*)
// ============================================================================

import { Router, Request, Response } from 'express';
import { demoExecutionEngine } from './demoExecutionEngine';
import { DemoTestCenterRunner } from './demoTestCenter';
import { BrokerExecutionCertifier } from './brokerExecutionCertifier';
import { ProductionReadinessCertifier } from './productionReadinessCertifier';
import { DemoExecutionMode } from './types';
import { firestoreTradeTraceService } from '../services/firestoreTradeTraceService';
import { reconciliationService } from '../services/reconciliationService';

export const demoRouter = Router();

// 1. Get Engine Status & Readiness
demoRouter.get('/status', (req: Request, res: Response) => {
  try {
    const status = demoExecutionEngine.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Set Execution Mode (DEMO_MANUAL / DEMO_ARMED / DEMO_AUTO)
demoRouter.post('/mode', (req: Request, res: Response) => {
  try {
    const { mode, operatorConfirmed } = req.body;
    if (!mode) {
      return res.status(400).json({ error: 'Mode parameter is required.' });
    }
    const result = demoExecutionEngine.setExecutionMode(mode as DemoExecutionMode, !!operatorConfirmed);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Arm Strategy for Demo Execution
demoRouter.post('/arm', (req: Request, res: Response) => {
  try {
    const { strategyId, modelId, market, instrument, maxTrades, maxExposure, maxDailyLoss, expirationMinutes } = req.body;
    if (!strategyId || !instrument) {
      return res.status(400).json({ error: 'strategyId and instrument are required.' });
    }
    const expirationTimestamp = Date.now() + (expirationMinutes || 120) * 60 * 1000;
    const result = demoExecutionEngine.armStrategy({
      strategyId,
      modelId: modelId || 'GBDT_PROD_V3',
      market: market || 'FOREX',
      instrument,
      maxTrades: maxTrades || 5,
      maxExposure: maxExposure || 25000,
      maxDailyLoss: maxDailyLoss || 1000,
      expirationTimestamp
    });
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Disarm Strategy
demoRouter.post('/disarm', (req: Request, res: Response) => {
  try {
    const { strategyId, reason } = req.body;
    demoExecutionEngine.disarmStrategy(strategyId || 'DEFAULT', reason || 'Operator manual disarm');
    res.json({ success: true, message: `Strategy ${strategyId} disarmed.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Construct & Validate Order Proposal
demoRouter.post('/propose', (req: Request, res: Response) => {
  try {
    const { signal, broker, environment, lotSize } = req.body;
    if (!signal) {
      return res.status(400).json({ error: 'Signal object is required to construct order proposal.' });
    }
    const proposal = demoExecutionEngine.constructOrderProposal(
      signal,
      broker || 'CTRADER',
      environment || 'DEMO',
      lotSize || 100000
    );
    const validation = demoExecutionEngine.validatePreOrder(proposal);
    res.json({ proposal, validation });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Submit Order to Demo Broker
demoRouter.post('/execute', async (req: Request, res: Response) => {
  try {
    const { proposal, clientOrderId } = req.body;
    if (!proposal) {
      return res.status(400).json({ error: 'Order proposal is required.' });
    }
    const result = await demoExecutionEngine.submitDemoOrder(proposal, clientOrderId);
    if (!result.success) {
      return res.status(422).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. List Orders & Positions
demoRouter.get('/orders', (req: Request, res: Response) => {
  try {
    const orders = demoExecutionEngine.getAllOrders();
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

demoRouter.get('/positions', (req: Request, res: Response) => {
  try {
    const positions = demoExecutionEngine.getAllPositions();
    res.json(positions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Close / Exit Position
demoRouter.post('/positions/:id/exit', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, exitPrice } = req.body;
    const result = demoExecutionEngine.closeDemoPosition(id, reason || 'MANUAL_EXIT', exitPrice);
    if (!result.success) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Update Live Prices on Positions (for trailing stops and TP/SL)
demoRouter.post('/positions/update-prices', (req: Request, res: Response) => {
  try {
    const { prices } = req.body;
    if (prices && typeof prices === 'object') {
      demoExecutionEngine.updatePositionPrices(prices);
    }
    res.json({ success: true, positions: demoExecutionEngine.getAllPositions() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Signal-to-Order Traceability
demoRouter.get('/trace/:signalId', (req: Request, res: Response) => {
  try {
    const { signalId } = req.params;
    const trace = demoExecutionEngine.getTraceForSignal(signalId);
    if (!trace) {
      return res.status(404).json({ error: 'Trace record not found for signal ID.' });
    }
    res.json(trace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Correlated Exposures
demoRouter.get('/exposures', (req: Request, res: Response) => {
  try {
    const groups = demoExecutionEngine.getCorrelatedExposureGroups();
    res.json(groups);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Kill Switch & Risk Lock Reset
demoRouter.post('/kill-switch', (req: Request, res: Response) => {
  try {
    const { action, reason } = req.body;
    const result = demoExecutionEngine.toggleKillSwitch(action === 'RESUME' ? 'RESUME' : 'HALT', reason || 'Operator UI');
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

demoRouter.post('/reset-daily-loss', (req: Request, res: Response) => {
  try {
    const { operatorId } = req.body;
    const result = demoExecutionEngine.resetDailyRiskLock(operatorId || 'RISK_OFFICER');
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Demo Test Center Runner (14 Tests)
demoRouter.post('/test-center/run', (req: Request, res: Response) => {
  try {
    const results = DemoTestCenterRunner.runAllDemoTests();
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Failure Recovery Test Runner (16 Scenarios)
demoRouter.post('/failure-tests/run', (req: Request, res: Response) => {
  try {
    const results = DemoTestCenterRunner.runFailureRecoverySuite();
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Restart Recovery Simulation
demoRouter.post('/restart-recovery/simulate', (req: Request, res: Response) => {
  try {
    const recovery = demoExecutionEngine.simulateApplicationRestart();
    res.json(recovery);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 16. Paper vs Demo vs Backtest Comparative Telemetry
demoRouter.get('/comparison', (req: Request, res: Response) => {
  try {
    const comparisons = demoExecutionEngine.getComparisons();
    res.json(comparisons);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 17. Firestore Cloud Trade Trace Lookup
demoRouter.get('/cloud-trace/:tradeTraceId', async (req: Request, res: Response) => {
  try {
    const { tradeTraceId } = req.params;
    const trace = await firestoreTradeTraceService.getTradeTrace(tradeTraceId);
    if (!trace) {
      return res.status(404).json({ error: 'Trade trace record not found in Cloud Firestore or local store.' });
    }
    const nodes = await firestoreTradeTraceService.getLifecycleNodes(tradeTraceId);
    res.json({ trace, nodes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 18. 3-Way Reconciliation Execution
demoRouter.post('/reconciliation/check', async (req: Request, res: Response) => {
  try {
    const { tradeTraceId, internalState, brokerState } = req.body;
    if (!tradeTraceId) {
      return res.status(400).json({ error: 'tradeTraceId is required for reconciliation.' });
    }
    const record = await reconciliationService.reconcileThreeWay(
      tradeTraceId,
      internalState,
      brokerState
    );
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 19. Reconciliation Records List
demoRouter.get('/reconciliation/records', (req: Request, res: Response) => {
  try {
    const records = reconciliationService.getAllLocalRecords();
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 20. Phase 8.5 Deep Broker Execution Certification (40 Scenarios)
demoRouter.post('/certification/run', async (req: Request, res: Response) => {
  try {
    const summary = await BrokerExecutionCertifier.runAll40CertificationScenarios();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 21. Phase 8.6 Production Readiness, Capital-Protection & Live-Gate Certification (50 Scenarios)
demoRouter.post('/production-readiness/run', async (req: Request, res: Response) => {
  try {
    const summary = await ProductionReadinessCertifier.runAll50Scenarios();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});



