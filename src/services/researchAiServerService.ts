import { executeQuery, executeRun } from '../database/db';

export type ResearchAiProvider = 'QWEN' | 'LLAMA';

export interface ResearchAiServerConfig {
  provider: ResearchAiProvider;
  enabled: boolean;
  baseUrl: string;
  model: string;
  healthPath: string;
  predictPath: string;
  timeoutMs: number;
  authConfigured: boolean;
  updatedAt: number | null;
}

interface StoredConfig extends Omit<ResearchAiServerConfig, 'authConfigured'> {
  authToken: string;
}

const DEFAULT_TIMEOUT_MS = 10000;

function normalizeProvider(value: unknown): ResearchAiProvider {
  return String(value || '').toUpperCase() === 'LLAMA' ? 'LLAMA' : 'QWEN';
}

function clampTimeout(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TIMEOUT_MS;
  return Math.min(60000, Math.max(1000, Math.floor(numeric)));
}

async function ensureTable(): Promise<void> {
  await executeRun(`CREATE TABLE IF NOT EXISTS ai_research_server_connections (
    provider TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    base_url TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    health_path TEXT NOT NULL DEFAULT '/health',
    predict_path TEXT NOT NULL DEFAULT '/predict',
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    auth_token TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`);
}

async function loadStored(provider: ResearchAiProvider): Promise<StoredConfig> {
  await ensureTable();
  const rows = await executeQuery<any>(
    'SELECT provider, enabled, base_url, model, health_path, predict_path, timeout_ms, auth_token, updated_at FROM ai_research_server_connections WHERE provider = ? LIMIT 1',
    [provider]
  );
  const row = rows[0];
  return {
    provider,
    enabled: Number(row?.enabled || 0) === 1,
    baseUrl: String(row?.base_url || ''),
    model: String(row?.model || ''),
    healthPath: String(row?.health_path || '/health'),
    predictPath: String(row?.predict_path || '/predict'),
    timeoutMs: clampTimeout(row?.timeout_ms),
    authToken: String(row?.auth_token || ''),
    updatedAt: row?.updated_at === undefined ? null : Number(row.updated_at)
  };
}

export async function getResearchAiServerConfigs(): Promise<ResearchAiServerConfig[]> {
  return Promise.all((['QWEN', 'LLAMA'] as ResearchAiProvider[]).map(async provider => {
    const stored = await loadStored(provider);
    return {
      provider: stored.provider,
      enabled: stored.enabled,
      baseUrl: stored.baseUrl,
      model: stored.model,
      healthPath: stored.healthPath,
      predictPath: stored.predictPath,
      timeoutMs: stored.timeoutMs,
      authConfigured: Boolean(stored.authToken),
      updatedAt: stored.updatedAt
    };
  }));
}

export async function saveResearchAiServerConfig(input: {
  provider: ResearchAiProvider;
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  healthPath?: string;
  predictPath?: string;
  timeoutMs?: number;
  authToken?: string;
}): Promise<ResearchAiServerConfig> {
  const provider = normalizeProvider(input.provider);
  const current = await loadStored(provider);
  const baseUrl = String(input.baseUrl ?? current.baseUrl).trim().replace(/\\/$/, '');
  const model = String(input.model ?? current.model).trim();
  const healthPath = String(input.healthPath ?? current.healthPath).trim() || '/health';
  const predictPath = String(input.predictPath ?? current.predictPath).trim() || '/predict';
  const authToken = input.authToken === undefined ? current.authToken : String(input.authToken);
  const enabled = input.enabled === undefined ? current.enabled : Boolean(input.enabled);
  const timeoutMs = clampTimeout(input.timeoutMs ?? current.timeoutMs);

  if (enabled && !/^https?:\\/\\//i.test(baseUrl)) {
    throw new Error(`${provider} AI server requires an HTTP(S) base URL when enabled.`);
  }

  const updatedAt = Date.now();
  await executeRun(
    `INSERT OR REPLACE INTO ai_research_server_connections
      (provider, enabled, base_url, model, health_path, predict_path, timeout_ms, auth_token, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [provider, enabled ? 1 : 0, baseUrl, model, healthPath, predictPath, timeoutMs, authToken, updatedAt]
  );

  return {
    provider,
    enabled,
    baseUrl,
    model,
    healthPath,
    predictPath,
    timeoutMs,
    authConfigured: Boolean(authToken),
    updatedAt
  };
}

export async function testResearchAiServerConnection(providerInput: ResearchAiProvider): Promise<{
  provider: ResearchAiProvider;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  message: string;
}> {
  const provider = normalizeProvider(providerInput);
  const config = await loadStored(provider);
  if (!config.baseUrl) {
    return { provider, ok: false, status: null, latencyMs: null, message: 'AI server URL is not configured.' };
  }

  const url = config.baseUrl + (config.healthPath.startsWith('/') ? config.healthPath : '/' + config.healthPath);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.authToken) headers.Authorization = `Bearer ${config.authToken}`;
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      return {
        provider,
        ok: response.ok,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        message: response.ok ? 'AI research server is reachable.' : `AI research server returned HTTP ${response.status}.`
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      provider,
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
