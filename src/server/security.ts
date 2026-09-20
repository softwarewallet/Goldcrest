import { createHmac, timingSafeEqual } from 'node:crypto';
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

export function blockLegacyTradingModes(req: Request, _res: Response, next: NextFunction): void {
  // Unsupported historical routes naturally return 404/405. Runtime trading is LIVE_ONLY.
  next();
}

const OPERATOR_SESSION_COOKIE = 'goldcrest_operator_session';
const OPERATOR_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function operatorKeyConfigured(): boolean {
  return Boolean(process.env.GOLDCREST_OPERATOR_API_KEY?.trim());
}

function safeEqual(a: string, b: string): boolean {
  const expected = Buffer.from(a, 'utf8');
  const actual = Buffer.from(b, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function makeOperatorSession(configuredKey: string, expiresAt: number): string {
  const payload = String(expiresAt);
  const signature = createHmac('sha256', configuredKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isValidOperatorSession(token: string | undefined, configuredKey: string): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !signature) return false;
  const expected = createHmac('sha256', configuredKey).update(String(expiresAt)).digest('base64url');
  return safeEqual(signature, expected);
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.header('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function sameOrigin(req: Request): boolean {
  const origin = req.header('Origin');
  if (!origin) return true;
  const expected = `${req.protocol}://${req.get('host')}`;
  return origin === expected;
}

function credentialsValid(configuredKey: string, supplied: string | undefined): boolean {
  if (!supplied || supplied.length !== configuredKey.length) return false;
  return safeEqual(supplied, configuredKey);
}

export function operatorAuthConfigured(): boolean {
  return operatorKeyConfigured();
}

export function issueOperatorSession(configuredKey: string): string {
  return makeOperatorSession(configuredKey, Date.now() + OPERATOR_SESSION_TTL_MS);
}

function isLocalDevelopmentRequest(req: Request): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const address = String(req.socket.remoteAddress || req.ip || '').toLowerCase();
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

export function operatorAuthRequired(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.GOLDCREST_OPERATOR_API_KEY?.trim();
  if (isLocalDevelopmentRequest(req)) {
    // Local development stays frictionless while production keeps the full operator session gate.
    next();
    return;
  }

  if (!configuredKey) {
    // If operator auth key is not configured, pass through so dev/preview environment works seamlessly
    next();
    return;
  }

  const headerCredential = req.header('X-Goldcrest-Operator-Key') || req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const sessionCredential = getCookie(req, OPERATOR_SESSION_COOKIE);
  const authenticatedByHeader = credentialsValid(configuredKey, headerCredential);
  const authenticatedBySession = isValidOperatorSession(sessionCredential, configuredKey);

  if (!authenticatedByHeader && !authenticatedBySession) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid operator credentials are required.' });
    return;
  }

  // Cookie-backed browser sessions are same-origin only to prevent cross-site state changes.
  if (!authenticatedByHeader && authenticatedBySession && req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    console.error(`[CRITICAL] CSRF Rejection: Method ${req.method} from origin ${req.header('Origin')}`);
    res.status(403).json({ error: 'CSRF_ORIGIN_REJECTED', message: 'Cross-origin state-changing requests are not permitted.' });
    return;
  }

  next();
}

export function setOperatorSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(OPERATOR_SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`);
}

export function clearOperatorSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${OPERATOR_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

export function isOperatorSessionValid(req: Request): boolean {
  const configuredKey = process.env.GOLDCREST_OPERATOR_API_KEY?.trim();
  return Boolean(configuredKey && isValidOperatorSession(getCookie(req, OPERATOR_SESSION_COOKIE), configuredKey));
}
