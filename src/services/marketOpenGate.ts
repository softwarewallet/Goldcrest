import { getForexSessionState } from '../markets/common/session';

export interface AutoLiveMarketGate {
  forex: {
    isOpen: boolean;
    sessions: string[];
  };
  anyMarketOpen: boolean;
  bothMarketsClosed: boolean;
}

export function getAutoLiveMarketGate(now: Date = new Date()): AutoLiveMarketGate {
  const forex = getForexSessionState(now);
  const forexOpen = !forex.activeSessions.includes('CLOSED (WEEKEND)');

  return {
    forex: {
      isOpen: forexOpen,
      sessions: [...forex.activeSessions]
    },
    anyMarketOpen: forexOpen,
    bothMarketsClosed: !forexOpen
  };
}
