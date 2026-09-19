import { BrokerAccountInfo, TradingEnvironment } from '../../types';

export interface CTraderRawAccount {
  ctidTraderAccountId: number;
  isLive: boolean;
  traderLogin: number;
  lastClosingDealTimestamp?: number;
  lastBalanceUpdateTimestamp?: number;
  brokerTitleShort?: string;
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
const MSG_EXECUTION_EVENT = 2126;
const MSG_ORDER_ERROR_EVENT = 2132;
const MSG_ERROR_RES = 2142;

/**
 * Executes a WebSocket request flow against the cTrader Open API (port 5036 JSON interface)
 */
export async function fetchLiveCTraderAccounts(
  clientId: string,
  clientSecret: string,
  accessToken: string,
  preferredHost: 'live' | 'demo' = 'live'
): Promise<CTraderRawAccount[]> {
  const hosts = preferredHost === 'live'
    ? ['wss://live.ctraderapi.com:5036']
    : ['wss://demo.ctraderapi.com:5036'];

  let lastError: Error | null = null;

  for (const host of hosts) {
    try {
      const accounts = await new Promise<CTraderRawAccount[]>((resolve, reject) => {
        const ws = new WebSocket(host);
        const timer = setTimeout(() => {
          try { ws.close(); } catch {}
          reject(new Error(`Timeout connecting to cTrader host: ${host}`));
        }, 8000);

        ws.onopen = () => {
          ws.send(JSON.stringify({
            clientMsgId: 'app_auth',
            payloadType: MSG_APP_AUTH_REQ,
            payload: { clientId, clientSecret }
          }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data.toString());
            if (msg.payloadType === MSG_APP_AUTH_RES) {
              ws.send(JSON.stringify({
                clientMsgId: 'acc_list',
                payloadType: MSG_GET_ACCOUNTS_REQ,
                payload: { accessToken }
              }));
            } else if (msg.payloadType === MSG_GET_ACCOUNTS_RES) {
              clearTimeout(timer);
              try { ws.close(); } catch {}
              const accList: CTraderRawAccount[] = msg.payload?.ctidTraderAccount || [];
              resolve(accList);
            } else if (msg.payloadType === MSG_ERROR_RES) {
              clearTimeout(timer);
              try { ws.close(); } catch {}
              reject(new Error(`cTrader API Error: ${JSON.stringify(msg.payload)}`));
            }
          } catch (e: any) {
            clearTimeout(timer);
            try { ws.close(); } catch {}
            reject(e);
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(err);
        };
      });

      if (accounts.length > 0) {
        return accounts;
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
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
  const host = rawAccount.isLive
    ? 'wss://live.ctraderapi.com:5036'
    : 'wss://demo.ctraderapi.com:5036';

  return new Promise<CTraderRealTraderDetails>((resolve, reject) => {
    const ws = new WebSocket(host);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`Timeout fetching account details from ${host}`));
    }, 10000);

    const assetMap: Record<number, string> = {
      1: 'EUR',
      2: 'GBP',
      16: 'USD',
      17: 'JPY',
      18: 'CHF',
      19: 'AUD',
      20: 'CAD'
    };

    let traderData: any = null;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        clientMsgId: 'app_auth',
        payloadType: MSG_APP_AUTH_REQ,
        payload: { clientId, clientSecret }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data.toString());

        if (msg.payloadType === MSG_APP_AUTH_RES) {
          // Authenticate account session
          ws.send(JSON.stringify({
            clientMsgId: 'acc_auth',
            payloadType: MSG_ACC_AUTH_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId,
              accessToken
            }
          }));
        } else if (msg.payloadType === MSG_ACC_AUTH_RES) {
          // Request asset list for accurate currency mapping
          ws.send(JSON.stringify({
            clientMsgId: 'asset_req',
            payloadType: MSG_ASSET_LIST_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId
            }
          }));
        } else if (msg.payloadType === MSG_ASSET_LIST_RES) {
          if (Array.isArray(msg.payload?.asset)) {
            for (const a of msg.payload.asset) {
              if (a.assetId && (a.name || a.displayName)) {
                assetMap[a.assetId] = a.name || a.displayName;
              }
            }
          }
          // Request Trader Details (balance, leverage, brokerName)
          ws.send(JSON.stringify({
            clientMsgId: 'trader_req',
            payloadType: MSG_TRADER_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId
            }
          }));
        } else if (msg.payloadType === MSG_TRADER_RES) {
          traderData = msg.payload?.trader;
          // Reconcile open positions and orders to verify equity
          ws.send(JSON.stringify({
            clientMsgId: 'reconcile_req',
            payloadType: MSG_RECONCILE_REQ,
            payload: {
              ctidTraderAccountId: rawAccount.ctidTraderAccountId
            }
          }));
        } else if (msg.payloadType === MSG_RECONCILE_RES) {
          clearTimeout(timer);
          try { ws.close(); } catch {}

          if (!traderData) {
            return reject(new Error('Trader data missing from cTrader Open API response'));
          }

          const moneyDigits = traderData.moneyDigits !== undefined ? Number(traderData.moneyDigits) : 2;
          const rawBalance = Number(traderData.balance);
          if (!Number.isFinite(rawBalance)) {
            return reject(new Error('cTrader trader details did not include a valid account balance.'));
          }
          const realBalance = rawBalance / Math.pow(10, moneyDigits);

          // cTrader trader details expose the authoritative used-margin value; the
          // reconcile response provides the account's current unrealized P/L. Derive
          // equity and free/available margin from those broker values rather than
          // presenting balance as synthetic equity.
          const reconcilePositions = Array.isArray(msg.payload?.position) ? msg.payload.position : [];
          const unrealizedPnl = reconcilePositions.reduce((sum: number, position: any) => {
            const value = Number(position?.unrealizedPnL ?? position?.tradeData?.unrealizedPnL ?? 0);
            return sum + (Number.isFinite(value) ? value / Math.pow(10, moneyDigits) : 0);
          }, 0);
          const equity = realBalance + unrealizedPnl;
          const rawUsedMargin = Number(traderData.totalMarginUsed ?? traderData.marginUsed ?? 0);
          const usedMargin = Number.isFinite(rawUsedMargin) ? rawUsedMargin / Math.pow(10, moneyDigits) : 0;
          const freeMargin = equity - usedMargin;
          const currency = assetMap[traderData.depositAssetId] || 'USD';

          resolve({
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
            moneyDigits
          });
        } else if (msg.payloadType === MSG_ERROR_RES) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          reject(new Error(`cTrader Account Error: ${JSON.stringify(msg.payload)}`));
        }
      } catch (err: any) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
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
    const timer = setTimeout(() => reject(new Error(`cTrader request timeout: ${expectedPayloadType}`)), timeoutMs);
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data.toString());
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

async function withAuthenticatedAccount<T>(
  accountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean,
  fn: (ws: WebSocket) => Promise<T>
): Promise<T> {
  const hosts = isLive
    ? ['wss://live.ctraderapi.com:5036']
    : ['wss://demo.ctraderapi.com:5036'];

  let lastError: any = null;

  for (const host of hosts) {
    const ws = new WebSocket(host);
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`cTrader market-data connection timeout on ${host}`)), 10000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`cTrader market-data WebSocket error on ${host}`));
      };
    });

    try {
      await connected;
      await sendAndAwait(ws, MSG_APP_AUTH_REQ, { clientId, clientSecret }, MSG_APP_AUTH_RES);
      await sendAndAwait(ws, MSG_ACC_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken }, MSG_ACC_AUTH_RES);
      return await fn(ws);
    } catch (err: any) {
      lastError = err;
    } finally {
      try { ws.close(); } catch {}
    }
  }

  throw lastError || new Error('cTrader API: failed to authenticate account on available cTrader endpoints.');
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
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
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
      const handler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data.toString());
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
  raw: any;
}

export async function submitLiveCTraderOrder(
  ctidTraderAccountId: number,
  symbolId: number,
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
  isLive: boolean
): Promise<CTraderOrderSubmission> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('cTrader order volume must be positive.');
  }

  const orderTypeMap: Record<string, number> = { MARKET: 1, LIMIT: 2, STOP: 3 };
  const tradeSideMap: Record<string, number> = { BUY: 1, SELL: 2 };
  const mappedType = orderTypeMap[orderType];
  const mappedSide = tradeSideMap[side];
  if (!mappedType || !mappedSide) throw new Error(`Unsupported cTrader order parameters: ${orderType}/${side}`);

  // cTrader volume is represented in 0.01 of a unit.
  const volume = Math.round(quantity * 100);
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
      const payload: Record<string, unknown> = {
        ctidTraderAccountId,
        symbolId,
        orderType: mappedType,
        tradeSide: mappedSide,
        volume,
        clientOrderId: requestClientId
      };

      if (orderType === 'LIMIT' && price !== undefined) payload.limitPrice = price;
      if (orderType === 'STOP' && price !== undefined) payload.stopPrice = price;
      if (stopLoss !== undefined && stopLoss > 0) payload.stopLoss = stopLoss;
      if (takeProfit !== undefined && takeProfit > 0) payload.takeProfit = takeProfit;

      return new Promise<CTraderOrderSubmission>((resolve, reject) => {
        let accepted: CTraderOrderSubmission | null = null;
        const timer = setTimeout(() => {
          ws.removeEventListener('message', handler);
          if (accepted) resolve(accepted);
          else reject(new Error('cTrader order submission timed out without broker acknowledgement.'));
        }, 15000);

        const finish = (value: CTraderOrderSubmission) => {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(value);
        };

        const fail = (message: string) => {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          reject(new Error(message));
        };

        const handler = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data.toString());

            if (msg.payloadType === MSG_ORDER_ERROR_EVENT || msg.payloadType === MSG_ERROR_RES) {
              const p = msg.payload || {};
              const related = !p.orderId || !accepted || Number(p.orderId) === accepted.orderId;
              if (related) fail(p.description || p.errorCode || 'cTrader rejected the live order.');
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
        ws.send(JSON.stringify({
          clientMsgId: requestClientId,
          payloadType: MSG_NEW_ORDER_REQ,
          payload
        }));
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
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
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
        pipPosition: Number(s.pipPosition || 4)
      }));
  });
}

export async function fetchCTraderReconcileState(
  ctidTraderAccountId: number,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  isLive: boolean
): Promise<{ positions: any[]; orders: any[] }> {
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
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
  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
    const clientMsgId = `quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<CTraderMarketQuote>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for cTrader spot event for ${symbol}`)), 10000);
      ws.addEventListener('message', event => {
        try {
          const msg = JSON.parse(event.data.toString());
          if (msg.payloadType === MSG_ERROR_RES) {
            clearTimeout(timer);
            reject(new Error(`cTrader quote error: ${JSON.stringify(msg.payload)}`));
          }
          if (msg.payloadType === MSG_SPOT_EVENT && Number(msg.payload?.symbolId) === symbolId) {
            const p = msg.payload;
            if (p.bid === undefined && p.ask === undefined) return;
            clearTimeout(timer);
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
      });
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

  return withAuthenticatedAccount(ctidTraderAccountId, clientId, clientSecret, accessToken, isLive, async ws => {
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
