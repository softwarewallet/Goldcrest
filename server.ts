});

app.use('/api/brokers', operatorAuthRequired, brokerRouter);
app.use('/api/ml', operatorAuthRequired, (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'RESEARCH_API_RETIRED',
    message: 'Goldcrest research program is closed. ML training, dataset generation, backtesting and experiment APIs are retired.'
  });
});
app.use('/api/governance', operatorAuthRequired, governanceRouter);

app.get('/api/auto-trading/status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.getStatus());
});

app.post('/api/auto-trading/start', operatorAuthRequired, (req: Request, res: Response) => {
  // During local development, the UI may be served through a wildcard/bind-all
  // host even though the operator is connecting from the same machine.
  // Detect loopback requests explicitly so the local auto-live arm path is
  // deterministic and does not depend on the HOST environment variable.
  if (process.env.NODE_ENV !== 'production' && process.env.GOLDCREST_LOCAL_DEVELOPMENT !== 'false') {
    const requestHost = String(req.headers.host || '').split(':')[0].trim().toLowerCase();
    const remoteAddress = String(req.socket.remoteAddress || req.ip || '').toLowerCase().replace(/^::ffff:/, '');
    const loopbackRequest = ['127.0.0.1', 'localhost', '::1'].includes(requestHost) ||
      ['127.0.0.1', 'localhost', '::1'].includes(remoteAddress);
    if (loopbackRequest) process.env.GOLDCREST_LOCAL_DEVELOPMENT = 'true';
  }

  const confirmWhenClosed = req.body?.confirmWhenClosed === true;
  const status = autoTradingService.start({ confirmWhenClosed });
  const statusCode = status.requiresClosedMarketConfirmation
    ? 409
    : (status.state === 'BLOCKED' ? 409 : 200);
  return res.status(statusCode).json(status);
});

app.post('/api/auto-trading/abandon-closed-start', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.abandonClosedMarketStart());
});

app.post('/api/auto-trading/stop', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(autoTradingService.stop());
});

app.get('/api/live-log/status', operatorAuthRequired, (_req: Request, res: Response) => {
  res.json(getLiveRuntimeLogStatus());
});
