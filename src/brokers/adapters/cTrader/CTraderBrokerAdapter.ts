      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const byId = new Map(symbols.map(s => [s.symbolId, s]));
    return state.orders.map((o: any) => {
      const trade = o.tradeData || {};
      const symbolInfo = byId.get(Number(trade.symbolId));
      if (!symbolInfo) return null;
      const orderTypeRaw = String(o.orderType || 'MARKET').toUpperCase();
      const orderType = orderTypeRaw.includes('STOP_LIMIT') ? 'STOP_LIMIT' : orderTypeRaw.includes('STOP') ? 'STOP' : orderTypeRaw.includes('LIMIT') ? 'LIMIT' : 'MARKET';
      const side = String(trade.tradeSide || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
      const quantity = Math.abs(Number(trade.volume || trade.volumeInUnits || 0)) / 100;
      const filledQuantity = Math.min(
        quantity,
        Math.abs(Number(o.filledVolume || o.executedVolume || trade.filledVolume || 0)) / 100
      );
      if (quantity <= 0) return null;
      const statusRaw = String(o.orderStatus || 'PENDING').toUpperCase();
      const status = statusRaw.includes('FILLED') ? 'FILLED'
        : statusRaw.includes('CANCEL') ? 'CANCELLED'
        : statusRaw.includes('REJECT') ? 'REJECTED'
        : statusRaw.includes('EXPIRE') ? 'EXPIRED'
        : filledQuantity > 0 && filledQuantity < quantity ? 'PARTIALLY_FILLED'
        : statusRaw.includes('ACCEPT') ? 'ACCEPTED'
        : 'PENDING';
      return {
        id: String(o.orderId),
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: symbolInfo.symbolName,
        side,
        orderType,
        quantity,
        price: Number(o.limitPrice || o.stopPrice || o.executionPrice || 0) || undefined,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        status,
        filledQuantity,
        averageFillPrice: Number(o.executionPrice || 0) || undefined,
        timestamp: Number(o.utcTimestamp || 0) * 1000 || Date.now(),
        brokerOrderId: String(o.orderId),
        clientOrderId: o.clientOrderId ? String(o.clientOrderId) : undefined
      } as NormalizedOrder;
    }).filter(Boolean) as NormalizedOrder[];
  }

  async getOrderByClientOrderId(clientOrderId: string): Promise<NormalizedOrder | null> {
    const normalizedClientOrderId = String(clientOrderId || '').trim().slice(0, 50);
    if (!normalizedClientOrderId) return null;
    const orders = await this.getOpenOrders();
    return orders.find(order => order.clientOrderId === normalizedClientOrderId) || null;
  }

  async getDailyRealizedPnL(): Promise<number> {
    this.syncConfig();