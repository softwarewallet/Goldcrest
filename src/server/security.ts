import type { NextFunction, Request, Response } from 'express';

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const requestCounts = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = 0;

function getClientKey(req: Request): string {
  return (req.ip || req.socket.remoteAddress || 'unknown').trim();
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('X-Request-ID');
  const id = supplied && /^[A-Za-z0-9._-]{1,100}$/.test(supplied)
    ? supplied
    : `gc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  res.setHeader('X-Request-ID', id);
  next();
}

export function apiRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/api') || req.path === '/api/health') {
    next();
    return;
  }

  const now = Date.now();
  if (now - lastCleanup > RATE_WINDOW_MS) {
    for (const [key, value] of requestCounts) {
      if (value.resetAt <= now) requestCounts.delete(key);
    }
    lastCleanup = now;
  }

  const key = getClientKey(req);
  const current = requestCounts.get(key);
  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }

  current.count += 1;
  if (current.count > RATE_LIMIT) {
    res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
    res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many API requests. Please retry later.' });
    return;
  }
  next();
}

export function blockLegacyTradingModes(req: Request, res: Response, next: NextFunction): void {
  const legacy = req.path === '/api/demo'
    || req.path.startsWith('/api/demo/')
    || req.path === '/api/paper'
    || req.path.startsWith('/api/paper/')
    || req.path === '/api/forex/paper'
    || req.path.startsWith('/api/forex/paper/');

  if (legacy) {
    res.status(410).json({
      error: 'LEGACY_TRADING_MODE_DISABLED',
      message: 'PAPER/DEMO workflows are retired. Goldcrest is LIVE_ONLY.'
    });
    return;
  }
  next();
}


export function operatorAuthRequired(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.GOLDCREST_OPERATOR_API_KEY?.trim();
  if (!configuredKey) {
    res.status(503).json({
      error: 'OPERATOR_AUTH_NOT_CONFIGURED',
      message: 'Protected operator API is disabled until GOLDCREST_OPERATOR_API_KEY is configured.'
    });
    return;
  }

  const supplied = req.header('X-Goldcrest-Operator-Key') || req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!supplied || supplied.length !== configuredKey.length) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid operator credentials are required.' });
    return;
  }

  let mismatch = 0;
  for (let i = 0; i < configuredKey.length; i++) mismatch |= supplied.charCodeAt(i) ^ configuredKey.charCodeAt(i);
  if (mismatch !== 0) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid operator credentials are required.' });
    return;
  }

  next();
}
