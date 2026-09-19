import { Router, Request, Response } from 'express';
import { operatorAuthRequired } from '../server/security';
import { autoTradingController } from './safety/AutoTradingController';

export const autoTradingRouter = Router();

autoTradingRouter.get('/status', async (_req: Request, res: Response) => {
  try { res.json(await autoTradingController.evaluateReadiness()); }
  catch (err: any) { res.status(503).json({ error: err?.message || 'Unable to evaluate auto-trading readiness.' }); }
});

autoTradingRouter.post('/arm', operatorAuthRequired, async (_req: Request, res: Response) => {
  try {
    const readiness = await autoTradingController.arm();
    res.status(readiness.ready ? 200 : 409).json(readiness);
  } catch (err: any) { res.status(503).json({ error: err?.message || 'Unable to arm auto-trading.' }); }
});

autoTradingRouter.post('/disarm', operatorAuthRequired, (_req: Request, res: Response) => {
  autoTradingController.disarm();
  res.json({ success: true, state: autoTradingController.getState(), executionAvailable: false, timestamp: Date.now() });
});