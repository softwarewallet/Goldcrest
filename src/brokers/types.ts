// Normalized types and interfaces for Phase 2B & 2C Broker Integration

export type TradingEnvironment = 'PAPER' | 'DEMO' | 'LIVE';

export type BrokerType = 'CTRADER' | 'FIVE_PAISA' | 'PAPER';

export type BrokerStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'STALE'
  | 'ERROR'
  | 'UNKNOWN';

export type BrokerErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'EMERGENCY_STOP_ACTIVE'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_MARGIN'
  | 'INVALID_SYMBOL'
  | 'INVALID_QUANTITY'
  | 'MARKET_CLOSED'
  | 'ORDER_REJECTED'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'BROKER_UNAVAILABLE'
  | 'INVALID_PRICE'
  | 'INVALID_STOP'
  | 'NOT_SUPPORTED'
  | 'UNKNOWN_ERROR';

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export interface BrokerAccountInfo {
  accountId: string;
  accountType: 'DEMO' | 'LIVE' | 'PAPER';
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  freeMargin: number;
  currency: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  connectionStatus: BrokerStatus;
  server?: string;
  permissions?: string[];
  lastUpdate: number;
  isLiveAccount?: boolean;
}

export interface NormalizedPosition {
  id: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  market: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  currency: string;
  timestamp: number;
  brokerPositionId?: string;
}

export interface NormalizedOrder {
  id: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  market: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice?: number;
  commission?: number;
  timestamp: number;
  brokerOrderId?: string;
  strategyId?: string;
  signalId?: string;
  rejectionReason?: string;
}

export interface OrderRequest {
  market: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  strategyId?: string;
  signalId?: string;
  comment?: string;
}

export interface OrderModification {
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
}

export interface NormalizedQuote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  source: string;
  environment: TradingEnvironment;
  status: 'FRESH' | 'DELAYED' | 'STALE';
}

export interface BrokerInstrument {
  symbol: string;
  market: string;
  pipSize: number;
  minQuantity: number;
  maxQuantity: number;
  stepQuantity: number;
  digits: number;
  supportedOrderTypes: OrderType[];
  baseCurrency?: string;
  quoteCurrency?: string;
}

export interface ConnectionTestResult {
  broker: BrokerType;
  environment: TradingEnvironment;
  connected: boolean;
  account?: string;
  accountType?: string;
  balance?: number;
  equity?: number;
  availableMargin?: number;
  currency?: string;
  server?: string;
  permissions?: string[];
  timestamp: number;
  latency?: number;
  error?: string;
}

export interface BrokerAdapter {
  readonly broker: BrokerType;
  readonly environment: TradingEnvironment;
  readonly isLive: boolean;

  authenticate(): Promise<boolean>;
  disconnect(): Promise<void>;
  testConnection(): Promise<ConnectionTestResult>;
  getAccount(): Promise<BrokerAccountInfo>;
  getAccounts?(): Promise<BrokerAccountInfo[]>; // Optional discovery method
  getBalance(): Promise<number>;
  getEquity(): Promise<number>;
  getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }>;
  getPositions(): Promise<NormalizedPosition[]>;
  getOpenOrders(): Promise<NormalizedOrder[]>;
  getOrderHistory(): Promise<NormalizedOrder[]>;
  getQuote(symbol: string): Promise<NormalizedQuote>;
  getInstrument(symbol: string): Promise<BrokerInstrument | null>;
  getInstruments(): Promise<BrokerInstrument[]>;
  placeOrder(order: OrderRequest): Promise<NormalizedOrder>;
  modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder>;
  cancelOrder(orderId: string): Promise<boolean>;
  closePosition(positionId: string, quantity?: number): Promise<boolean>;
  getOrderStatus(orderId: string): Promise<NormalizedOrder>;
  getTradingStatus(): Promise<BrokerStatus>;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  source: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  account: string;
  action: string;
  symbol?: string;
  quantity?: number;
  price?: number;
  orderId?: string;
  signalId?: string;
  strategyId?: string;
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  error?: string;
  riskValidation?: {
    passed: boolean;
    checks: Record<string, boolean>;
    reason?: string;
  };
  executionValidation?: {
    passed: boolean;
    reason?: string;
  };
}

export interface LiveTradingGateResult {
  passed: boolean;
  checks: {
    liveEnvironmentSelected: boolean;
    liveBrokerConnected: boolean;
    accountValidated: boolean;
    tradingPermissionConfirmed: boolean;
    instrumentValidated: boolean;
    marketOpen: boolean;
    marketDataFresh: boolean;
    signalStillValid: boolean;
    riskCheckPassed: boolean;
    positionSizeCheckPassed: boolean;
    dailyLossLimitNotExceeded: boolean;
    maxExposureNotExceeded: boolean;
    duplicatePositionCheckPassed: boolean;
    orderParametersValidated: boolean;
    explicitLivePermissionEnabled: boolean;
  };
  failedReasons: string[];
}

export interface LiveControlsConfig {
  liveConnectionEnabled: boolean;
  liveTradingEnabled: boolean;
  autoExecutionEnabled: boolean;
  emergencyHalted: boolean;
}

export interface BrokerCredentialStatus {
  broker: BrokerType;
  environment: TradingEnvironment;
  configured: boolean;
  hasAccessToken?: boolean;
  hasTotpSecret?: boolean;
  maskedAccountId?: string;
  maskedClientId?: string;
  maskedClientSecret?: string;
  maskedAccessToken?: string;
  maskedTotpSecret?: string;
  maskedPin?: string;
  maskedAppName?: string;
  maskedAppSource?: string;
  maskedUserId?: string;
  maskedPassword?: string;
  maskedUserKey?: string;
  maskedEncryptionKey?: string;
  maskedClientCode?: string;
  status: BrokerStatus;
  lastTestResult?: ConnectionTestResult;
}
