import { Router, Request, Response } from 'express';

export const mlRouter = Router();

mlRouter.use((_req: Request, res: Response) => {
  res.status(410).json({
    error: 'RESEARCH_API_RETIRED',
    message: 'Goldcrest LIVE_ONLY runtime does not expose ML simulation, paper, demo, or sandbox execution workflows.'
  });
});
