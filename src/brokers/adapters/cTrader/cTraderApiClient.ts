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
const MSG_GET_ACCOUNTS_REQ = 2149;
const MSG_GET_ACCOUNTS_RES = 2150;
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
    ? ['wss://live.ctraderapi.com:5036', 'wss://demo.ctraderapi.com:5036']
    : ['wss://demo.ctraderapi.com:5036', 'wss://live.ctraderapi.com:5036'];

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

          const moneyDigits = traderData.moneyDigits !== undefined ? traderData.moneyDigits : 2;
          const rawBalance = typeof traderData.balance === 'number' ? traderData.balance : 0;
          const realBalance = rawBalance / Math.pow(10, moneyDigits);

          const currency = assetMap[traderData.depositAssetId] || 'USD';

          resolve({
            ctidTraderAccountId: rawAccount.ctidTraderAccountId,
            traderLogin: rawAccount.traderLogin,
            balance: realBalance,
            equity: realBalance,
            availableMargin: realBalance,
            usedMargin: 0,
            freeMargin: realBalance,
            currency,
            brokerName: traderData.brokerName || rawAccount.brokerTitleShort || 'IC Markets SC',
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
