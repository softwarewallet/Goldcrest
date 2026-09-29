import WebSocket from 'ws';
import { BrokerAccountInfo, TradingEnvironment } from '../../types';
import { getCTraderApiMode } from '../../../services/configService';
import { recordTradeRequest, recordTradeResult } from '../../../services/tradeAuditLog';

export interface CTraderRawAccount {
  ctidTraderAccountId: number;
  isLive: boolean;
  traderLogin: number;
  lastClosingDealTimestamp?: number;
  lastBalanceUpdateTimestamp?: number;
  brokerTitleShort?: string;
  /** cTrader Open API token scope: 0=view, 1=trade. */
  permissionScope?: number;
}

export interface CTraderRealTraderDetails {
  ctidTraderAccountId: number;
  traderLogin: number;
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  freeMargin: number;
  currency: string;
  brokerName?: string;
  isLive: boolean;
  leverageInCents?: number;
  moneyDigits: number;
  /** cTrader account access rights: 0=FULL_ACCESS, 1=CLOSE_ONLY, 2=NO_TRADING, 3=NO_LOGIN. */
  accessRights?: number;
}

const MSG_APP_AUTH_REQ = 2100;
const MSG_APP_AUTH_RES = 2101;
const MSG_ACC_AUTH_REQ = 2102;
const MSG_ACC_AUTH_RES = 2103;
const MSG_ASSET_LIST_REQ = 2112;
const MSG_ASSET_LIST_RES = 2113;
const MSG_TRADER_REQ = 2121;
const MSG_TRADER_RES = 2122;
const MSG_RECONCILE_REQ = 2124;
const MSG_RECONCILE_RES = 2125;
const MSG_SYMBOLS_LIST_REQ = 2114;
const MSG_SYMBOLS_LIST_RES = 2115;
const MSG_SUBSCRIBE_SPOTS_REQ = 2127;
const MSG_SUBSCRIBE_SPOTS_RES = 2128;
const MSG_SPOT_EVENT = 2131;
const MSG_GET_TRENDBARS_REQ = 2137;
const MSG_GET_TRENDBARS_RES = 2138;
const MSG_SUBSCRIBE_LIVE_TRENDBAR_REQ = 2135;
const MSG_GET_ACCOUNTS_REQ = 2149;
const MSG_GET_ACCOUNTS_RES = 2150;
const MSG_NEW_ORDER_REQ = 2106;
const MSG_CANCEL_ORDER_REQ = 2108;
const MSG_AMEND_ORDER_REQ = 2109;
const MSG_AMEND_POSITION_SLTP_REQ = 2110;
const MSG_CLOSE_POSITION_REQ = 2111;
const MSG_DEAL_LIST_REQ = 2133;
const MSG_DEAL_LIST_RES = 2134;
const MSG_DEAL_LIST_BY_POSITION_ID_REQ = 2179;
const MSG_DEAL_LIST_BY_POSITION_ID_RES = 2180;
const MSG_EXECUTION_EVENT = 2126;
const MSG_ORDER_ERROR_EVENT = 2132;
const MSG_ORDER_DETAILS_REQ = 2181;
const MSG_ORDER_DETAILS_RES = 2182;
const MSG_SYMBOLS_FOR_CONVERSION_REQ = 2118;
const MSG_SYMBOLS_FOR_CONVERSION_RES = 2119;
const MSG_ERROR_RES = 2142;
const MSG_GET_POSITION_UNREALIZED_PNL_REQ = 2187;
const MSG_GET_POSITION_UNREALIZED_PNL_RES = 2188;

/**
 * cTrader API endpoint is selected explicitly as LIVE or DEMO. Goldcrest's
 * application trading mode remains LIVE_ONLY; this setting controls the
 * cTrader Open API connection environment independently.
 */
function getConfiguredCTraderWsHost(mode: 'LIVE' | 'DEMO'): string | null {
  const primaryKey = mode === 'DEMO' ? 'CTRADER_DEMO_API_HOST' : 'CTRADER_LIVE_API_HOST';
  const configured = String(process.env[primaryKey] || '').trim();
  if (!configured || configured.toLowerCase() === 'auto') return null;
  return configured;
}

function getCTraderWsHost(_accountIsLive?: boolean): string {
  const mode = getCTraderApiMode();
  const configured = getConfiguredCTraderWsHost(mode);
  if (configured) return configured;
  return mode === 'DEMO'
    ? 'wss://demo.ctraderapi.com:5036'
    : 'wss://live.ctraderapi.com:5036';
}

export function filterCTraderAccountsForApiMode(
  accounts: CTraderRawAccount[],
  mode: 'LIVE' | 'DEMO'
): CTraderRawAccount[] {
  const expectedLive = mode === 'LIVE';
  return accounts.filter(account => account.isLive === expectedLive);
}

/**
 * Resolve the cTrader WebSocket endpoint from the selected LIVE or DEMO API mode.
 * Goldcrest remains LIVE_ONLY at the application trading-environment layer.
 */
export function getCTraderRequestHosts(_accountIsLive: boolean): string[] {
  return [getCTraderWsHost()];
}

/**
 * Executes a WebSocket request flow against the cTrader Open API (port 5036 JSON interface)
 */
export async function fetchLiveCTraderAccounts(
  clientId: string,
  clientSecret: string,
  accessToken: string,
  _preferredHost: 'live' = 'live'
): Promise<CTraderRawAccount[]> {
  const hosts = getCTraderRequestHosts(true);
  let lastError: Error | null = null;

  for (const host of hosts) {
    try {
      const accounts = await getCTraderConnectionSession(host).runApp(
        clientId,
        clientSecret,
        async ws => {
          const payload = await sendAndAwait(
            ws,
            MSG_GET_ACCOUNTS_REQ,
            { accessToken },
            MSG_GET_ACCOUNTS_RES,
            15000
          );
          const permissionScope = payload?.permissionScope !== undefined
            ? Number(payload.permissionScope)
            : undefined;
          const accList: CTraderRawAccount[] = (payload?.ctidTraderAccount || []).map((account: CTraderRawAccount) => ({
            ...account,
            permissionScope
          }));
          const mode = getCTraderApiMode();
          const eligibleAccounts = filterCTraderAccountsForApiMode(accList, mode);
          if (eligibleAccounts.length === 0) {
            throw new Error(
              `cTrader returned accounts, but none match the selected ${mode} Open API account environment.`
            );
          }
          return eligibleAccounts;
        }
      );
      if (accounts.length > 0) return accounts;
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '');
      if (msg.includes('CANT_ROUTE_REQUEST') || msg.includes('Cannot route request')) continue;
    }
  }

  throw lastError || new Error('cTrader API: failed to discover authenticated accounts.');
}

/**
 * Fetches genuine real-time balance and account details from cTrader Open API
 */
export async function fetchLiveCTraderAccountDetails(
  rawAccount: CTraderRawAccount,
  clientId: string,
  clientSecret: string,
  accessToken: string
): Promise<CTraderRealTraderDetails> {
  const mode = getCTraderApiMode();
  const expectedLive = mode === 'LIVE';
  if (rawAccount.isLive !== expectedLive) {
    return Promise.reject(new Error(
      `cTrader account ${rawAccount.ctidTraderAccountId} is marked ${rawAccount.isLive ? 'LIVE' : 'DEMO'}, but the selected cTrader API mode is ${mode}.`
    ));
  }

  const host = getCTraderWsHost(rawAccount.isLive);

  return getCTraderConnectionSession(host).run(
    rawAccount.ctidTraderAccountId,
    clientId,
    clientSecret,
    accessToken,
    async ws => {
      const assetPayload = await sendAndAwait(
        ws,
        MSG_ASSET_LIST_REQ,
        { ctidTraderAccountId: rawAccount.ctidTraderAccountId },
        MSG_ASSET_LIST_RES,
        15000
      );
      const assetMap: Record<number, string> = {
        1: 'EUR',
        2: 'GBP',
        16: 'USD',
        17: 'JPY',
        18: 'CHF',
        19: 'AUD',
        20: 'CAD'
      };
      if (Array.isArray(assetPayload?.asset)) {
        for (const asset of assetPayload.asset) {
          if (asset.assetId && (asset.name || asset.displayName)) {
            assetMap[Number(asset.assetId)] = String(asset.name || asset.displayName);
          }
        }
      }

      const traderPayload = await sendAndAwait(
        ws,
        MSG_TRADER_REQ,
        { ctidTraderAccountId: rawAccount.ctidTraderAccountId },
        MSG_TRADER_RES,
        15000
      );
      const traderData = traderPayload?.trader;
      if (!traderData) {
        throw new Error('Trader data missing from cTrader Open API response');
      }

      const moneyDigits = traderData.moneyDigits !== undefined ? Number(traderData.moneyDigits) : 2;
      const rawBalance = Number(traderData.balance);
      if (!Number.isFinite(rawBalance)) {
        throw new Error('cTrader trader details did not include a valid account balance.');
      }
      const realBalance = rawBalance / Math.pow(10, moneyDigits);

      const reconcilePayload = await sendAndAwait(
        ws,
        MSG_RECONCILE_REQ,
        { ctidTraderAccountId: rawAccount.ctidTraderAccountId },
        MSG_RECONCILE_RES,
        15000
      );
      const reconcilePositions = Array.isArray(reconcilePayload?.position)
        ? reconcilePayload.position
        : [];

      const pnlPayload = await sendAndAwait(
        ws,
        MSG_GET_POSITION_UNREALIZED_PNL_REQ,
        { ctidTraderAccountId: rawAccount.ctidTraderAccountId },
        MSG_GET_POSITION_UNREALIZED_PNL_RES,
        15000
      );
      const pnlMoneyDigits = pnlPayload?.moneyDigits !== undefined
        ? Number(pnlPayload.moneyDigits)
        : moneyDigits;
      const pnlDivisor = Math.pow(
        10,
        Number.isFinite(pnlMoneyDigits) ? pnlMoneyDigits : moneyDigits
      );
      const pnlRows = Array.isArray(pnlPayload?.positionUnrealizedPnL)
        ? pnlPayload.positionUnrealizedPnL
        : [];
      const netUnrealizedPnl = pnlRows.reduce((sum: number, row: any) => {
        const raw = Number(row?.netUnrealizedPnL ?? 0);
        return Number.isFinite(raw) ? sum + raw / pnlDivisor : sum;
      }, 0);
      const equity = realBalance + netUnrealizedPnl;

      const usedMargin = reconcilePositions.reduce((sum: number, position: any) => {
        const raw = Number(position?.usedMargin ?? 0);
        if (!Number.isFinite(raw) || raw < 0) return sum;
        const positionDigits = position?.moneyDigits !== undefined
          ? Number(position.moneyDigits)
          : moneyDigits;
        const divisor = Math.pow(
          10,
          Number.isFinite(positionDigits) ? positionDigits : moneyDigits
        );
        return sum + raw / divisor;
      }, 0);

      const freeMargin = equity - usedMargin;
      const currency = assetMap[traderData.depositAssetId] || 'USD';

      return {
        ctidTraderAccountId: rawAccount.ctidTraderAccountId,
        traderLogin: rawAccount.traderLogin,
        balance: realBalance,
        equity,
        availableMargin: freeMargin,
        usedMargin,
        freeMargin,
        currency,
        brokerName: traderData.brokerName || rawAccount.brokerTitleShort || 'cTrader',
        isLive: rawAccount.isLive,
        leverageInCents: traderData.leverageInCents,
        moneyDigits,
        accessRights: traderData.accessRights !== undefined ? Number(traderData.accessRights) : undefined
      };
    }
  );
}


export interface CTraderAssetInfo {
  assetId: number;
  name: string;
  displayName?: string;
  digits?: number;
}

export interface CTraderConversionSymbol {
  symbolId: number;
  symbolName: string;
  baseAssetId?: number;
  quoteAssetId?: number;
}

export async function fetchCTraderAssets(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderAssetInfo[]> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_ASSET_LIST_REQ, { ctidTraderAccountId }, MSG_ASSET_LIST_RES, 15000);
    const assets = Array.isArray(payload.asset) ? payload.asset : [];
    return assets
      .filter((a: any) => a.assetId !== undefined && (a.name || a.displayName))
      .map((a: any) => ({
        assetId: Number(a.assetId),
        name: String(a.name || a.displayName).toUpperCase(),
        displayName: a.displayName ? String(a.displayName) : undefined,
        digits: a.digits !== undefined ? Number(a.digits) : undefined
      }));
  });
}

export async function fetchCTraderConversionSymbols(
  ctidTraderAccountId: number,
  firstAssetId: number,
  lastAssetId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderConversionSymbol[]> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_SYMBOLS_FOR_CONVERSION_REQ, {
      ctidTraderAccountId,
      firstAssetId,
      lastAssetId
    }, MSG_SYMBOLS_FOR_CONVERSION_RES, 15000);
    const symbols = Array.isArray(payload.symbol) ? payload.symbol : [];
    return symbols
      .filter((s: any) => s.symbolId !== undefined && s.symbolName)
      .map((s: any) => ({
        symbolId: Number(s.symbolId),
        symbolName: String(s.symbolName),
        baseAssetId: s.baseAssetId !== undefined ? Number(s.baseAssetId) : undefined,
        quoteAssetId: s.quoteAssetId !== undefined ? Number(s.quoteAssetId) : undefined
      }));
  });
}

export interface CTraderMarketQuote {
  symbol: string;
  symbolId: number;
  bid?: number;
  ask?: number;
  timestamp: number;
  status: 'FRESH' | 'STALE';
}

export interface CTraderCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface CTraderSymbolInfo {
  symbolId: number;
  symbolName: string;
  digits: number;
  pipPosition: number;
  /** cTrader protocol volume constraints are expressed in 1/100 of a base unit. */
  minVolume?: number;
  maxVolume?: number;
  stepVolume?: number;
  lotSize?: number;
  baseAssetId?: number;
  quoteAssetId?: number;
}

const TREND_BAR_PERIODS: Record<string, number> = {
  '1M': 1, '2M': 2, '3M': 3, '4M': 4, '5M': 5, '10M': 6,
  '15M': 7, '30M': 8, '1H': 9, '4H': 10, '12H': 11, 'DAILY': 12, '1D': 12, 'D': 12,
  '1W': 13, '1MN': 14
};

function priceFromRelative(value: number, digits = 5): number {
  return value / Math.pow(10, digits);
}

function sendAndAwait(
  ws: WebSocket,
  payloadType: number,
  payload: Record<string, unknown>,
  expectedPayloadType: number,
  timeoutMs = 10000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const clientMsgId = `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`cTrader request timeout: ${expectedPayloadType}`));
    }, timeoutMs);
    const handler = (event: any) => {
      try {
        const raw = typeof event?.data === 'string' ? event.data : (event?.data || event).toString();
        const msg = JSON.parse(raw);
        if (msg.clientMsgId === clientMsgId && msg.payloadType === expectedPayloadType) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(msg.payload || {});
        } else if (msg.payloadType === MSG_ERROR_RES && (!msg.clientMsgId || msg.clientMsgId === clientMsgId)) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          reject(new Error(`cTrader API error: ${JSON.stringify(msg.payload)}`));
        }
      } catch {}
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
  });
}

const CTRADER_HEARTBEAT_PAYLOAD_TYPE = 51;
const CTRADER_CONNECTION_TIMEOUT_MS = 12000;
const CTRADER_HEARTBEAT_INTERVAL_MS = 10000;

/**
 * One persistent JSON WebSocket is maintained per cTrader environment/host.
 *
 * Auto Live performs many independent market-data reads. Opening a new
 * WebSocket for every quote, candle, position, instrument, and risk check
 * creates connection churn and can exhaust the cTrader connection path.
 * cTrader recommends no more than one persistent connection per environment,
 * heartbeat traffic, and queued request/response handling.
 */
class CTraderConnectionSession {
  private ws: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly requestQueue: Array<{
    priority: 0 | 1;
    run: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  private queueRunning = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private authenticatedClientKey: string | null = null;
  private authenticatedAccountId: number | null = null;

  constructor(private readonly host: string) {}

  private resetSocket(socket?: WebSocket): void {
    if (socket && this.ws !== socket) return;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.ws = null;
    this.connecting = null;
    this.authenticatedClientKey = null;
    this.authenticatedAccountId = null;
  }

  private async connect(clientId: string, clientSecret: string): Promise<WebSocket> {
    const clientKey = `${clientId}\0${clientSecret}`;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticatedClientKey === clientKey) {
      return this.ws;
    }
    if (this.connecting) return this.connecting;

    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.resetSocket(this.ws);
    }

    const ws = new WebSocket(this.host);
    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch {}
        this.resetSocket(ws);
        reject(new Error(`cTrader market-data connection timeout on ${this.host}`));
      }, CTRADER_CONNECTION_TIMEOUT_MS);

      ws.on('open', async () => {
        if (settled) return;
        try {
          await sendAndAwait(ws, MSG_APP_AUTH_REQ, { clientId, clientSecret }, MSG_APP_AUTH_RES, 10000);
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          this.ws = ws;
          this.authenticatedClientKey = clientKey;
          this.authenticatedAccountId = null;
          this.heartbeatTimer = setInterval(() => {
            if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ payloadType: CTRADER_HEARTBEAT_PAYLOAD_TYPE }));
              } catch {
                try { ws.close(); } catch {}
              }
            }
          }, CTRADER_HEARTBEAT_INTERVAL_MS);
          resolve(ws);
        } catch (error) {
          clearTimeout(timer);
          settled = true;
          try { ws.close(); } catch {}
          this.resetSocket(ws);
          reject(error);
        }
      });

      ws.on('error', (error: any) => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          this.resetSocket(ws);
          reject(error || new Error(`cTrader market-data WebSocket error on ${this.host}`));
          return;
        }
        if (this.ws === ws) {
          this.resetSocket(ws);
        }
      });

      ws.on('close', () => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          this.resetSocket(ws);
          reject(new Error(`cTrader market-data WebSocket closed before authentication on ${this.host}`));
          return;
        }
        if (this.ws === ws) {
          this.resetSocket(ws);
        }
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private async authorizeAccount(
    ws: WebSocket,
    accountId: number,
    accessToken: string
  ): Promise<void> {
    if (this.authenticatedAccountId === accountId) return;
    await sendAndAwait(
      ws,
      MSG_ACC_AUTH_REQ,
      { ctidTraderAccountId: accountId, accessToken },
      MSG_ACC_AUTH_RES,
      10000
    );
    this.authenticatedAccountId = accountId;
  }

  async runApp<T>(
    clientId: string,
    clientSecret: string,
    fn: (ws: WebSocket) => Promise<T>
  ): Promise<T> {
    return this.enqueue(0, async () => {
      const ws = await this.connect(clientId, clientSecret);
      return fn(ws);
    });
  }

  private enqueue<T>(priority: 0 | 1, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push({
        priority,
        run: async () => run(),
        resolve: value => resolve(value as T),
        reject
      });
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      while (this.requestQueue.length > 0) {
        const highPriorityIndex = this.requestQueue.findIndex(item => item.priority === 1);
        const index = highPriorityIndex >= 0 ? highPriorityIndex : 0;
        const item = this.requestQueue.splice(index, 1)[0];
        try {
          const value = await item.run();
          item.resolve(value);
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.queueRunning = false;
    }
  }

  async run<T>(
    accountId: number,
    clientId: string,
    clientSecret: string,
    accessToken: string,
    fn: (ws: WebSocket) => Promise<T>
  ): Promise<T> {
    return this.enqueue(0, async () => {
      const ws = await this.connect(clientId, clientSecret);
      await this.authorizeAccount(ws, accountId, accessToken);
      try {
        return await fn(ws);
      } catch (error) {
        if (this.ws === ws && String((error as any)?.message || '').toLowerCase().includes('connection')) {
          this.resetSocket(ws);
          try { ws.close(); } catch {}
        }
        throw error;
      }
    });
  }

  async runPriority<T>(
    accountId: number,
    clientId: string,
    clientSecret: string,
    accessToken: string,
    fn: (ws: WebSocket) => Promise<T>
  ): Promise<T> {
    return this.enqueue(1, async () => {
      const ws = await this.connect(clientId, clientSecret);
      await this.authorizeAccount(ws, accountId, accessToken);
      try {
        return await fn(ws);
      } catch (error) {
        if (this.ws === ws && String((error as any)?.message || '').toLowerCase().includes('connection')) {
          this.resetSocket(ws);
          try { ws.close(); } catch {}
        }
        throw error;
      }
    });
  }
}

const cTraderConnectionSessions = new Map<string, CTraderConnectionSession>();

function getCTraderConnectionSession(host: string): CTraderConnectionSession {
  let session = cTraderConnectionSessions.get(host);
  if (!session) {
    session = new CTraderConnectionSession(host);
    cTraderConnectionSessions.set(host, session);
  }
  return session;
}

async function withAuthenticatedAccount<T>(
  accountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  fn: (ws: WebSocket) => Promise<T>,
  priority: 'NORMAL' | 'AUTO_LIVE' = 'NORMAL'
): Promise<T> {
  // Route account-scoped reads through the selected cTrader environment.
  // The session is persistent and serializes account-scoped requests so Auto
  // Live does not create a new WebSocket for every market-data operation.
  const hosts = getCTraderRequestHosts(isLive);
  let lastError: any = null;

  for (const host of hosts) {
    try {
      const session = getCTraderConnectionSession(host);
      return await (priority === 'AUTO_LIVE' ? session.runPriority : session.run)(
        accountId,
        clientId,
        clientSecret,
        accessToken,
        fn
      );
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '');
      if (msg.includes('CANT_ROUTE_REQUEST') || msg.includes('Cannot route request')) {
        continue;
      }
    }
  }

  throw lastError || new Error('cTrader API: failed to authenticate account on available cTrader endpoints.');
}

async function withAutoLiveAuthenticatedAccount<T>(
  accountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  fn: (ws: WebSocket) => Promise<T>
): Promise<T> {
  return withAuthenticatedAccount(accountId, clientId, clientSecret, accessToken, isLive, fn, 'AUTO_LIVE');
}

export interface CTraderExecutionActionResult {
  executionType: number;
  orderId?: number;
  positionId?: number;
  raw: any;
}

async function submitLiveCTraderExecutionAction(
  ctidTraderAccountId: number, payloadType: number, payload: Record<string, unknown>,
  clientMsgId: string, clientId: string, clientSecret: string, accessToken: string, isLive: boolean,
  expectedOrderId?: number, expectedPositionId?: number
): Promise<CTraderExecutionActionResult> {
  return withAutoLiveAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    return new Promise<CTraderExecutionActionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error('cTrader live execution action timed out without broker acknowledgement.'));
      }, 15000);
      const finish = (value: CTraderExecutionActionResult) => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(value);
      };
      const fail = (message: string) => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        reject(new Error(message));
      };
      const handler = (event: any) => {
        try {
          const raw = typeof event?.data === 'string' ? event.data : (event?.data || event).toString();
          const msg = JSON.parse(raw);
          if (msg.payloadType === MSG_ORDER_ERROR_EVENT || msg.payloadType === MSG_ERROR_RES) {
            const p = msg.payload || {};
            fail(p.description || p.errorCode || 'cTrader rejected the execution action.');
            return;
          }
          if (msg.payloadType !== MSG_EXECUTION_EVENT) return;
          const p = msg.payload || {};
          const order = p.order || {};
          const position = p.position || {};
          const orderId = Number(order.orderId ?? p.orderId ?? 0) || undefined;
          const positionId = Number(position.positionId ?? p.positionId ?? 0) || undefined;
          if (expectedOrderId !== undefined && orderId !== expectedOrderId) return;
          if (expectedPositionId !== undefined && positionId !== expectedPositionId) return;
          finish({ executionType: Number(p.executionType ?? 0), orderId, positionId, raw: msg });
        } catch {}
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ clientMsgId, payloadType, payload }));
    });
  });
}

export async function cancelLiveCTraderOrder(
  ctidTraderAccountId: number, orderId: number, clientId: string, clientSecret: string,
  accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_CANCEL_ORDER_REQ,
    { ctidTraderAccountId, orderId }, 'gc-cancel-' + orderId + '-' + Date.now(),
    clientId, clientSecret, accessToken, isLive, orderId);
}

export async function amendLiveCTraderOrder(
  ctidTraderAccountId: number, orderId: number,
  modifications: { volume?: number; limitPrice?: number; stopPrice?: number; stopLoss?: number; takeProfit?: number },
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  const payload: Record<string, unknown> = { ctidTraderAccountId, orderId };
  if (modifications.volume !== undefined) payload.volume = Math.round(modifications.volume * 100);
  if (modifications.limitPrice !== undefined) payload.limitPrice = modifications.limitPrice;
  if (modifications.stopPrice !== undefined) payload.stopPrice = modifications.stopPrice;
  if (modifications.stopLoss !== undefined) payload.stopLoss = modifications.stopLoss;
  if (modifications.takeProfit !== undefined) payload.takeProfit = modifications.takeProfit;
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_AMEND_ORDER_REQ, payload,
    'gc-amend-' + orderId + '-' + Date.now(), clientId, clientSecret, accessToken, isLive, orderId);
}

export async function amendLiveCTraderPositionSLTP(
  ctidTraderAccountId: number, positionId: number, stopLoss: number | undefined, takeProfit: number | undefined,
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  const payload: Record<string, unknown> = { ctidTraderAccountId, positionId };
  if (stopLoss !== undefined) payload.stopLoss = stopLoss;
  if (takeProfit !== undefined) payload.takeProfit = takeProfit;
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_AMEND_POSITION_SLTP_REQ, payload,
    'gc-amend-position-' + positionId + '-' + Date.now(), clientId, clientSecret, accessToken, isLive, undefined, positionId);
}

export async function closeLiveCTraderPosition(
  ctidTraderAccountId: number, positionId: number, volume: number,
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<CTraderExecutionActionResult> {
  const protocolVolume = Math.round(volume * 100);
  if (!Number.isSafeInteger(protocolVolume) || protocolVolume <= 0) throw new Error('cTrader close volume must be positive.');
  return submitLiveCTraderExecutionAction(ctidTraderAccountId, MSG_CLOSE_POSITION_REQ,
    { ctidTraderAccountId, positionId, volume: protocolVolume },
    'gc-close-position-' + positionId + '-' + Date.now(), clientId, clientSecret, accessToken, isLive, undefined, positionId);
}

export interface CTraderOrderSubmission {
  orderId: number;
  positionId?: number;
  status: 'ACCEPTED' | 'FILLED' | 'REJECTED';
  executionPrice?: number;
  executedVolume?: number;
  stopLoss?: number;
  takeProfit?: number;
  raw: any;
}

export async function submitLiveCTraderOrder(
  ctidTraderAccountId: number,
  symbolId: number,
  symbol: string,
  orderType: 'MARKET' | 'LIMIT' | 'STOP',
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number | undefined,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
  clientOrderId: string,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  stopLossPips?: number,
  takeProfitPips?: number,
  pipSize?: number
): Promise<CTraderOrderSubmission> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('cTrader order volume must be positive.');
  }

  const orderTypeMap: Record<string, number> = { MARKET: 1, LIMIT: 2, STOP: 3 };
  const tradeSideMap: Record<string, number> = { BUY: 1, SELL: 2 };
  const mappedType = orderTypeMap[orderType];
  const mappedSide = tradeSideMap[side];
  if (!mappedType || !mappedSide) throw new Error(`Unsupported cTrader order parameters: ${orderType}/${side}`);

  // Goldcrest order quantity is an integer execution quantity. cTrader's
  // protocol volume is represented in 0.01 of a unit, so convert the integer
  // quantity to an integer protocol volume without introducing decimal values.
  const normalizedQuantity = Math.floor(quantity);
  if (!Number.isSafeInteger(normalizedQuantity) || normalizedQuantity <= 0) {
    throw new Error('cTrader order quantity must resolve to a positive integer.');
  }
  const volume = normalizedQuantity * 100;
  if (!Number.isSafeInteger(volume) || volume <= 0) {
    throw new Error('cTrader order volume is outside the supported integer range.');
  }

  return withAuthenticatedAccount(
    ctidTraderAccountId,
    clientId,
    clientSecret,
    accessToken,
    isLive,
    async ws => {
      const requestClientId = clientOrderId.slice(0, 50);
      const tradeAuditId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const payload: Record<string, unknown> = {
        ctidTraderAccountId,
        symbolId,
        orderType: mappedType,
        tradeSide: mappedSide,
        volume,
        clientOrderId: requestClientId,
        // Hardcoded: every cTrader order must have a trailing stop loss.
        trailingStopLoss: true
      };

      if (orderType === 'LIMIT' && price !== undefined) payload.limitPrice = price;
      if (orderType === 'STOP' && price !== undefined) payload.stopPrice = price;

      // cTrader MARKET orders must use relative protection distances rather
      // than absolute SL/TP prices. Relative protection is evaluated from the
      // actual fill price, so 10 pips remains 10 pips even when execution
      // slips from the quote. cTrader encodes relative price distance in
      // 1/100000 of a price unit.
      const hasRelativeProtection = Number.isFinite(Number(stopLossPips))
        && Number(stopLossPips) > 0
        && Number.isFinite(Number(takeProfitPips))
        && Number(takeProfitPips) > 0
        && Number.isFinite(Number(pipSize))
        && Number(pipSize) > 0;
      if (hasRelativeProtection) {
        payload.relativeStopLoss = Math.round(Number(stopLossPips) * Number(pipSize) * 100000);
        payload.relativeTakeProfit = Math.round(Number(takeProfitPips) * Number(pipSize) * 100000);
      } else {
        if (stopLoss !== undefined && stopLoss > 0) payload.stopLoss = stopLoss;
        if (takeProfit !== undefined && takeProfit > 0) payload.takeProfit = takeProfit;
      }

      return new Promise<CTraderOrderSubmission>((resolve, reject) => {
        let accepted: CTraderOrderSubmission | null = null;
        let resultLogged = false;

        const logResult = (result: {
          status: 'ACCEPTED' | 'FILLED' | 'REJECTED' | 'FAILED' | 'TIMEOUT';
          orderId?: number;
          executionPrice?: number;
          executedVolume?: number;
          error?: string;
          response?: unknown;
        }) => {
          if (resultLogged) return;
          resultLogged = true;
          try {
            recordTradeResult({
              tradeAuditId,
              broker: 'CTRADER',
              environment: 'LIVE',
              ...result
            });
          } catch (logError) {
            console.error('[TRADE-LOG] Failed to record trade result:', logError);
          }
        };
        const timer = setTimeout(() => {
          ws.removeEventListener('message', handler);
          if (accepted) {
            logResult({
              status: 'ACCEPTED',
              orderId: accepted.orderId,
              executionPrice: accepted.executionPrice,
              executedVolume: accepted.executedVolume,
              response: accepted.raw
            });
            resolve(accepted);
          } else {
            const error = 'cTrader order submission timed out without broker acknowledgement.';
            logResult({ status: 'TIMEOUT', error });
            reject(new Error(error));
          }
        }, 15000);

        const finish = (value: CTraderOrderSubmission) => {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          logResult({
            status: value.status === 'FILLED' ? 'FILLED' : 'ACCEPTED',
            orderId: value.orderId,
            executionPrice: value.executionPrice,
            executedVolume: value.executedVolume,
            response: value.raw
          });
          resolve(value);
        };

        const fail = (message: string, response?: unknown) => {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          logResult({ status: 'REJECTED', error: message, response });
          reject(new Error(message));
        };

        const handler = (event: any) => {
          try {
            const raw = typeof event?.data === 'string' ? event.data : (event?.data || event).toString();
            const msg = JSON.parse(raw);

            if (msg.payloadType === MSG_ORDER_ERROR_EVENT || msg.payloadType === MSG_ERROR_RES) {
              const p = msg.payload || {};
              const related = !p.orderId || !accepted || Number(p.orderId) === accepted.orderId;
              if (related) {
                const rawDescription = String(p.description || p.errorCode || 'cTrader rejected the live order.');
                // cTrader sometimes formats integer protocol volumes as
                // decimals in its human-readable rejection text (e.g. 20000.00).
                // Keep the broker's wording but normalize whole-number volumes
                // in Goldcrest audit/operator logs to the exact integer packet value.
                const description = rawDescription.replace(/(volume\s*=\s*)(\d+)\.00\b/gi, '$1$2').replace(/(maximum allowed volume\s*=\s*)(\d+)\.00\b/gi, '$1$2');
                if (/TRADE permission required/i.test(description)) {
                  fail('BROKER_REJECTED [cTrader LIVE]: TRADE permission is not granted to the current access token/account. Re-authorize Goldcrest with the cTrader "trading" scope and ensure the account has FULL_ACCESS trading rights.');
                } else {
                  // Preserve the broker's exact rejection and explicitly identify
                  // cTrader as the source so UI/operator logs never imply that
                  // Goldcrest invented the broker constraint.
                  fail(`BROKER_REJECTED [cTrader LIVE]: ${description}`);
                }
              }
              return;
            }

            if (msg.payloadType !== MSG_EXECUTION_EVENT) return;

            const p = msg.payload || {};
            const order = p.order || {};
            const deal = p.deal || {};
            const orderId = Number(order.orderId ?? p.orderId ?? 0);
            const clientIdMatches = !order.clientOrderId || order.clientOrderId === requestClientId;
            if (!clientIdMatches) return;

            const executionType = Number(p.executionType ?? 0);
            const orderStatus = Number(order.orderStatus ?? 0);
            const executionPrice = Number(
              deal.executionPrice ?? order.executionPrice ?? p.executionPrice
            );
            const executedVolumeRaw = Number(
              deal.filledVolume ?? order.executedVolume ?? p.executedVolume ?? 0
            );

            const normalized: CTraderOrderSubmission = {
              orderId,
              positionId: order.positionId !== undefined ? Number(order.positionId) : undefined,
              status: executionType === 7 || orderStatus === 3
                ? 'REJECTED'
                : (executionType === 3 || orderStatus === 2 || Number(deal.dealStatus) === 2)
                  ? 'FILLED'
                  : 'ACCEPTED',
              executionPrice: Number.isFinite(executionPrice) && executionPrice > 0 ? executionPrice : undefined,
              executedVolume: executedVolumeRaw > 0 ? executedVolumeRaw / 100 : undefined,
              stopLoss: Number.isFinite(Number(order.stopLoss)) && Number(order.stopLoss) > 0 ? Number(order.stopLoss) : undefined,
              takeProfit: Number.isFinite(Number(order.takeProfit)) && Number(order.takeProfit) > 0 ? Number(order.takeProfit) : undefined,
              raw: msg
            };

            if (!normalized.orderId) return;

            if (normalized.status === 'REJECTED') {
              fail('cTrader broker rejected the live order.');
            } else if (normalized.status === 'FILLED') {
              finish(normalized);
            } else {
              accepted = normalized;
              // Keep the connection open briefly for the subsequent fill event.
            }
          } catch {
            // Ignore unrelated/non-JSON WebSocket frames.
          }
        };

        ws.addEventListener('message', handler);

        try {
          recordTradeRequest({
            tradeAuditId,
            broker: 'CTRADER',
            environment: 'LIVE',
            accountId: ctidTraderAccountId,
            symbolId,
            symbol,
            orderType,
            side,
            volume,
            price,
            stopLoss,
            takeProfit,
            stopLossPips,
            takeProfitPips,
            pipSize,
            trailingStopLoss: true,
            clientOrderId: requestClientId,
            packet: {
              clientMsgId: requestClientId,
              payloadType: MSG_NEW_ORDER_REQ,
              payload
            }
          });
        } catch (logError) {
          console.error('[TRADE-LOG] Failed to record trade request:', logError);
        }

        // ProtoOANewOrderReq accepts broker volume, not Goldcrest's normalized
        // quantity field. The exact broker payload must contain only cTrader API
        // fields; Goldcrest's normalized quantity is intentionally never
        // copied into the broker payload.
        const forbiddenPayloadFields = ['quantity', 'quantityUnits', 'protocolVolume'];
        for (const field of forbiddenPayloadFields) {
          if (Object.prototype.hasOwnProperty.call(payload, field)) {
            throw new Error(`INVALID_CTRADER_ORDER_PACKET: ${field} is not a ProtoOANewOrderReq field.`);
          }
        }
        if (payload.volume !== volume) {
          throw new Error('INVALID_CTRADER_ORDER_PACKET: payload.volume does not match the final protocol volume.');
        }

        const packet = JSON.stringify({
          clientMsgId: requestClientId,
          payloadType: MSG_NEW_ORDER_REQ,
          payload
        });

        try {
          ws.send(packet);
        } catch (sendError: any) {
          const message = `cTrader request transmission failed: ${sendError?.message || String(sendError)}`;
          logResult({ status: 'FAILED', error: message });
          reject(new Error(message));
        }
      });
    }
  );
}

export async function fetchCTraderSymbols(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderSymbolInfo[]> {
  return withAutoLiveAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_SYMBOLS_LIST_REQ, {
      ctidTraderAccountId,
      includeArchivedSymbols: false
    }, MSG_SYMBOLS_LIST_RES, 15000);
    const symbols = Array.isArray(payload.symbol) ? payload.symbol : [];
    return symbols
      .filter((s: any) => s.enabled !== false && s.symbolId !== undefined && s.symbolName)
      .map((s: any) => ({
        symbolId: Number(s.symbolId),
        symbolName: String(s.symbolName),
        digits: Number(s.digits || 5),
        pipPosition: Number(s.pipPosition || 4),
        minVolume: Number(s.minVolume || 0) || undefined,
        maxVolume: Number(s.maxVolume || 0) || undefined,
        stepVolume: Number(s.stepVolume || 0) || undefined,
        lotSize: Number(s.lotSize || 0) || undefined,
        baseAssetId: Number(s.baseAssetId || 0) || undefined,
        quoteAssetId: Number(s.quoteAssetId || 0) || undefined
      }));
  });
}

export async function fetchCTraderOrderDetails(
  ctidTraderAccountId: number,
  orderId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<{ order: any | null; deals: any[] }> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_ORDER_DETAILS_REQ, {
      ctidTraderAccountId,
      orderId
    }, MSG_ORDER_DETAILS_RES, 15000);
    return {
      order: payload?.order || null,
      deals: Array.isArray(payload?.deal) ? payload.deal : []
    };
  });
}

export async function fetchCTraderDeals(
  ctidTraderAccountId: number, fromTimestamp: number, toTimestamp: number,
  clientId: string, clientSecret: string, accessToken: string, isLive: boolean
): Promise<any[]> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_DEAL_LIST_REQ, {
      ctidTraderAccountId, fromTimestamp, toTimestamp, maxRows: 10000
    }, MSG_DEAL_LIST_RES, 15000);
    return Array.isArray(payload.deal) ? payload.deal : [];
  });
}

export async function fetchCTraderDealsByPositionId(
  ctidTraderAccountId: number,
  positionId: number,
  fromTimestamp: number,
  toTimestamp: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<any[]> {
  return withAuthenticatedAccount(
    ctidTraderAccountId,
    clientId,
    clientSecret,
    accessToken,
    isLive,
    async ws => {
      const payload = await sendAndAwait(ws, MSG_DEAL_LIST_BY_POSITION_ID_REQ, {
        ctidTraderAccountId,
        positionId,
        fromTimestamp: Math.max(0, Number(fromTimestamp)),
        toTimestamp: Math.max(0, Number(toTimestamp))
      }, MSG_DEAL_LIST_BY_POSITION_ID_RES, 15000);
      return Array.isArray(payload.deal) ? payload.deal : [];
    }
  );
}

export interface CTraderPositionUnrealizedPnL {
  positionId: number;
  grossUnrealizedPnL: number;
  netUnrealizedPnL: number;
  moneyDigits: number;
}

export async function fetchCTraderPositionUnrealizedPnL(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<CTraderPositionUnrealizedPnL[]> {
  return withAutoLiveAuthenticatedAccount(
    ctidTraderAccountId,
    clientId,
    clientSecret,
    accessToken,
    isLive,
    async ws => {
      const payload = await sendAndAwait(
        ws,
        MSG_GET_POSITION_UNREALIZED_PNL_REQ,
        { ctidTraderAccountId },
        MSG_GET_POSITION_UNREALIZED_PNL_RES,
        10000
      );
      const moneyDigits = Number(payload.moneyDigits ?? 0);
      const divisor = Math.pow(10, Number.isFinite(moneyDigits) ? moneyDigits : 0);
      const rows = Array.isArray(payload.positionUnrealizedPnL)
        ? payload.positionUnrealizedPnL
        : [];
      return rows
        .filter((row: any) => row?.positionId !== undefined)
        .map((row: any) => ({
          positionId: Number(row.positionId),
          grossUnrealizedPnL: Number(row.grossUnrealizedPnL || 0) / divisor,
          netUnrealizedPnL: Number(row.netUnrealizedPnL || 0) / divisor,
          moneyDigits
        }));
    }
  );
}

export async function fetchCTraderReconcileState(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<{ positions: any[]; orders: any[] }> {
  return withAutoLiveAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_RECONCILE_REQ, { ctidTraderAccountId }, MSG_RECONCILE_RES, 15000);
    return {
      positions: Array.isArray(payload.position) ? payload.position : [],
      orders: Array.isArray(payload.order) ? payload.order : []
    };
  });
}

export async function fetchLiveCTraderQuote(
  ctidTraderAccountId: number,
  symbolId: number,
  symbol: string,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  digits: number
): Promise<CTraderMarketQuote> {
  return withAutoLiveAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const clientMsgId = `quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<CTraderMarketQuote>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off?.('message', onMsg);
        ws.removeEventListener?.('message', onMsg);
        reject(new Error(`Timeout waiting for cTrader spot event for ${symbol}`));
      }, 3000);
      const onMsg = (data: any) => {
        try {
          const raw = typeof data === 'string' ? data : (data?.data ?? data).toString();
          const msg = JSON.parse(raw);
          if (msg.payloadType === MSG_ERROR_RES) {
            clearTimeout(timer);
            ws.off?.('message', onMsg);
            reject(new Error(`cTrader quote error: ${JSON.stringify(msg.payload)}`));
          }
          if (msg.payloadType === MSG_SPOT_EVENT && Number(msg.payload?.symbolId) === symbolId) {
            const p = msg.payload;
            if (p.bid === undefined && p.ask === undefined) return;
            clearTimeout(timer);
            ws.off?.('message', onMsg);
            resolve({
              symbol,
              symbolId,
              bid: p.bid === undefined ? undefined : priceFromRelative(Number(p.bid), digits),
              ask: p.ask === undefined ? undefined : priceFromRelative(Number(p.ask), digits),
              timestamp: p.timestamp ? Number(p.timestamp) : Date.now(),
              status: 'FRESH'
            });
          }
        } catch {}
      };
      ws.on('message', onMsg);
      ws.send(JSON.stringify({
        clientMsgId,
        payloadType: MSG_SUBSCRIBE_SPOTS_REQ,
        payload: {
          ctidTraderAccountId,
          symbolId: [symbolId],
          subscribeToSpotTimestamp: true
        }
      }));
    });
  });
}

export async function fetchCTraderTrendbars(
  ctidTraderAccountId: number,
  symbolId: number,
  periodName: string,
  count: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  digits: number
): Promise<CTraderCandle[]> {
  const normalizedKey = String(periodName || '15M').trim().toUpperCase();
  const period = TREND_BAR_PERIODS[normalizedKey] || TREND_BAR_PERIODS['15M'];
  if (!period) throw new Error(`Unsupported cTrader trendbar period: ${periodName}`);
  const safeCount = Math.min(Math.max(Math.floor(count), 1), 1000);
  const toTimestamp = Date.now();
  const fromTimestamp = toTimestamp - safeCount * ({1: 60, 2: 120, 3: 180, 4: 240, 5: 300, 6: 600, 7: 900, 8: 1800, 9: 3600, 10: 14400, 11: 43200, 12: 86400, 13: 604800, 14: 2592000} as Record<number, number>)[period] * 1000;

  return withAutoLiveAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const payload = await sendAndAwait(ws, MSG_GET_TRENDBARS_REQ, {
      ctidTraderAccountId,
      symbolId,
      period,
      count: safeCount,
      fromTimestamp,
      toTimestamp
    }, MSG_GET_TRENDBARS_RES, 15000);

    const trendbars = Array.isArray(payload.trendbar) ? payload.trendbar : [];
    return trendbars.map((bar: any) => {
      const low = priceFromRelative(Number(bar.low || 0), digits);
      const open = priceFromRelative(Number(bar.low || 0) + Number(bar.deltaOpen || 0), digits);
      const close = priceFromRelative(Number(bar.low || 0) + Number(bar.deltaClose || 0), digits);
      const high = priceFromRelative(Number(bar.low || 0) + Number(bar.deltaHigh || 0), digits);
      return {
        open: Number(open.toFixed(digits)),
        high: Number(high.toFixed(digits)),
        low: Number(low.toFixed(digits)),
        close: Number(close.toFixed(digits)),
        volume: Number(bar.volume || 0),
        timestamp: Number(bar.utcTimestampInMinutes || 0) * 60 * 1000
      };
    }).filter((bar: CTraderCandle) => bar.low > 0 && bar.high >= bar.low && bar.close > 0);
  });
}
