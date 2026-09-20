import fs from 'node:fs';
import path from 'node:path';

export type LiveLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'TRADE' | 'SYSTEM';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'goldcrest-live.log');

let enabled = false;

function ensureLogFile(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
  }
}

function sanitize(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw
    .replace(/((?:client[_ -]?secret|secret|access[_ -]?token|api[_ -]?key|password|user[_ -]?key|encryption[_ -]?key|totp[_ -]?secret|pin))\s*[:=]\s*[^,;\s\]}]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, token => token.length > 40 ? '[REDACTED_TOKEN]' : token);
}

function writeLine(level: LiveLogLevel, event: string, details?: unknown): void {
  if (!enabled) return;
  ensureLogFile();
  const timestamp = new Date().toISOString();
  const detailText = details === undefined ? '' : ` | ${sanitize(details)}`;
  const line = `[${timestamp}] [${level}] [${event}]${detailText}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (error) {
    console.error('[LIVE-LOG] Failed to append log file:', error);
  }
}

export function startLiveRuntimeLog(source = 'SETTINGS'): {
  enabled: boolean;
  file: string;
} {
  ensureLogFile();
  enabled = true;
  writeLine('SYSTEM', 'LIVE_LOG_STARTED', { source, pid: process.pid, cwd: process.cwd() });
  return { enabled, file: LOG_FILE };
}

export function stopLiveRuntimeLog(source = 'SETTINGS'): {
  enabled: boolean;
  file: string;
} {
  if (enabled) writeLine('SYSTEM', 'LIVE_LOG_STOPPED', { source });
  enabled = false;
  return { enabled, file: LOG_FILE };
}

export function isLiveRuntimeLogEnabled(): boolean {
  return enabled;
}

export function getLiveRuntimeLogStatus(): {
  enabled: boolean;
  file: string;
  exists: boolean;
  sizeBytes: number;
  lastModifiedAt: string | null;
} {
  ensureLogFile();
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(LOG_FILE);
  } catch {
    stat = null;
  }
  return {
    enabled,
    file: LOG_FILE,
    exists: Boolean(stat),
    sizeBytes: stat?.size ?? 0,
    lastModifiedAt: stat?.mtime?.toISOString() ?? null
  };
}

export function liveRuntimeLog(level: LiveLogLevel, event: string, details?: unknown): void {
  writeLine(level, event, details);
}

export function getLiveRuntimeLogFile(): string {
  return LOG_FILE;
}
