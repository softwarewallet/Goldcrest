  private executionQueue: Promise<void> = Promise.resolve();
  private currentExecution: AutoTradingExecutionStatus = {
    stage: 'IDLE',
    pair: null,
    side: null,
    signalId: null,
    message: 'Waiting for the next Auto Live cycle.',
    updatedAt: Date.now()
  };
  private lastExecution: AutoTradingExecutionStatus | null = null;

  private isRequested(): boolean {
    // Development mode is not itself an execution request. Autonomous live
    // execution must be explicitly armed through the two runtime flags.
    return process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true'
      && process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  }


  private async withExecutionLock<T>(worker: () => Promise<T>): Promise<T> {
    const previous = this.executionQueue;