    const raw = await this.resolveRawAccount();
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const normalizedSymbol = order.symbol.replace('/', '').toUpperCase();
    const symbol = symbols.find(s => s.symbolName.replace('/', '').toUpperCase() === normalizedSymbol);
    if (!symbol) {
      throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${order.symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
    }

    const clientOrderId = (order.signalId || order.strategyId || `gc-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50) || `gc-${Date.now()}`;
    const submitted = await submitLiveCTraderOrder(
      raw.ctidTraderAccountId,
      symbol.symbolId,
      order.symbol,
      order.orderType as 'MARKET' | 'LIMIT' | 'STOP',
      order.side,
      order.quantity,
      order.price,
      order.stopLoss,
      order.takeProfit,
      clientOrderId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
