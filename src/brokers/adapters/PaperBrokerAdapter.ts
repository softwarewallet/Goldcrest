import { BaseBrokerAdapter } from './BaseBrokerAdapter';
import { FOREX_PAIRS } from '../../markets/forex/instruments';
import {
  BrokerAccountInfo,
  BrokerInstrument,
  BrokerStatus,
  BrokerType,
  ConnectionTestResult,
  NormalizedOrder,
  NormalizedPosition,
  NormalizedQuote,
  OrderModification,
  OrderRequest,
  TradingEnvironment,
  OrderType
} from '../types';
import { BrokerError } from '../errors';
import { killSwitch } from '../safety/KillSwitch';

export class PaperBrokerAdapter extends BaseBrokerAdapter {
  readonly broker: BrokerType = 'PAPER';
  readonly environment: TradingEnvironment = 'PAPER';
  readonly isLive: boolean = false;

  private balance: number = 100000.0;
  private equity: number = 100000.0;
  private usedMargin: number = 0.0;
  private positions: Map<string, NormalizedPosition> = new Map();
  private orders: Map<string, NormalizedOrder> = new Map();

  constructor() {
    super();
    this.status = 'CONNECTED';
  }

  async authenticate(): Promise<boolean> {
    this.status = 'CONNECTED';
    return true;
  }

  async disconnect(): Promise<void> {
    this.status = 'DISCONNECTED';
  }

  async testConnection(): Promise<ConnectionTestResult> {
    this.status = 'CONNECTED';
    const res: ConnectionTestResult = {
      broker: 'PAPER',
      environment: 'PAPER',
      connected: true,
      account: 'PAPER-SIM-001',
      accountType: 'PAPER',
      balance: this.balance,
      equity: this.equity,
      currency: 'USD',
      server: 'Local-Simulation-Engine',
      permissions: ['SIMULATE_FOREX', 'SIMULATE_INDIAN_OPTIONS', 'SIMULATE_EQUITY'],
      timestamp: Date.now()
    };
    this.lastConnectionTest = res;
    return res;
  }

  async getAccount(): Promise<BrokerAccountInfo> {
    return {
      accountId: 'PAPER-SIM-001',
      accountType: 'PAPER',
      balance: this.balance,
      equity: this.equity,
      availableMargin: this.balance - this.usedMargin,
      usedMargin: this.usedMargin,
      freeMargin: this.balance - this.usedMargin,
      currency: 'USD',
      broker: 'PAPER',
      environment: 'PAPER',
      connectionStatus: this.status,
      server: 'Local-Simulation-Engine',
      permissions: ['SIMULATION_ONLY'],
      lastUpdate: Date.now(),
      isLiveAccount: false
    };
  }

  async getBalance(): Promise<number> {
    return this.balance;
  }

  async getEquity(): Promise<number> {
    return this.equity;
  }

  async getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }> {
    const freeMargin = this.balance - this.usedMargin;
    const marginLevelPct = this.usedMargin > 0 ? (this.equity / this.usedMargin) * 100 : 999;
    return { usedMargin: this.usedMargin, freeMargin, marginLevelPct };
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    return Array.from(this.positions.values());
  }

  async getOpenOrders(): Promise<NormalizedOrder[]> {
    return Array.from(this.orders.values()).filter(o => o.status === 'PENDING' || o.status === 'ACCEPTED');
  }

  async getOrderHistory(): Promise<NormalizedOrder[]> {
    return Array.from(this.orders.values());
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    // Normal baseline synthetic quote for paper simulation
    const bid = 1.0850;
    const ask = 1.08512;
    return {
      symbol,
      bid,
      ask,
      spread: 0.00012,
      timestamp: Date.now(),
      source: 'PAPER_SIMULATION',
      environment: 'PAPER',
      status: 'FRESH'
    };
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    return FOREX_PAIRS.map(p => ({
      symbol: p.symbol,
      market: 'FOREX',
      pipSize: p.pipSize,
      minQuantity: 1000,
      maxQuantity: 10000000,
      stepQuantity: 1000,
      digits: p.digits,
      supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']
    }));
  }

  async getInstrument(symbol: string): Promise<BrokerInstrument | null> {
    return {
      symbol,
      market: symbol.includes('/') ? 'FOREX' : 'INDIA_EQUITY',
      pipSize: symbol.includes('JPY') ? 0.01 : 0.0001,
      minQuantity: 1000,
      maxQuantity: 10000000,
      stepQuantity: 1000,
      digits: 5,
      supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']
    };
  }

  async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    if (killSwitch.isHalted()) {
      throw new BrokerError(
        'EMERGENCY_STOP_ACTIVE',
        'Trading is currently HALTED by Emergency Kill Switch. All order placement is prohibited.',
        'PAPER',
        'PAPER'
      );
    }

    this.validateOrderTypeSupport(order.orderType, ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']);

    const orderId = 'paper_ord_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const fillPrice = order.price || 1.0850;

    const normalized: NormalizedOrder = {
      id: orderId,
      broker: 'PAPER',
      environment: 'PAPER',
      market: order.market,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      price: order.price,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      status: order.orderType === 'MARKET' ? 'FILLED' : 'ACCEPTED',
      filledQuantity: order.orderType === 'MARKET' ? order.quantity : 0,
      averageFillPrice: order.orderType === 'MARKET' ? fillPrice : undefined,
      commission: 0,
      timestamp: Date.now(),
      strategyId: order.strategyId,
      signalId: order.signalId
    };

    this.orders.set(orderId, normalized);

    if (order.orderType === 'MARKET') {
      const posId = 'paper_pos_' + Date.now();
      const pos: NormalizedPosition = {
        id: posId,
        broker: 'PAPER',
        environment: 'PAPER',
        market: order.market,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        unrealizedPnL: 0,
        realizedPnL: 0,
        currency: 'USD',
        timestamp: Date.now()
      };
      this.positions.set(posId, pos);
    }

    this.logAction('PLACE_ORDER', 'SUCCESS', 'PAPER-SIM-001', {
      symbol: order.symbol,
      quantity: order.quantity,
      price: fillPrice,
      orderId
    });

    return normalized;
  }

  async modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new BrokerError('ORDER_REJECTED', `Order ${orderId} not found`, 'PAPER', 'PAPER');
    }
    if (modifications.price !== undefined) order.price = modifications.price;
    if (modifications.stopLoss !== undefined) order.stopLoss = modifications.stopLoss;
    if (modifications.takeProfit !== undefined) order.takeProfit = modifications.takeProfit;
    if (modifications.quantity !== undefined) order.quantity = modifications.quantity;

    this.orders.set(orderId, order);
    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;
    order.status = 'CANCELLED';
    this.orders.set(orderId, order);
    return true;
  }

  async closePosition(positionId: string, quantity?: number): Promise<boolean> {
    const pos = this.positions.get(positionId);
    if (!pos) return false;
    this.positions.delete(positionId);
    this.logAction('CLOSE_POSITION', 'SUCCESS', 'PAPER-SIM-001', {
      symbol: pos.symbol,
      quantity: quantity || pos.quantity
    });
    return true;
  }

  async getOrderStatus(orderId: string): Promise<NormalizedOrder> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new BrokerError('ORDER_REJECTED', `Order ${orderId} not found`, 'PAPER', 'PAPER');
    }
    return order;
  }
}
