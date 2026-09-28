import { ForexSessionState } from './types';

/**
 * Calculates current active Forex trading sessions based on UTC time.
 * Standard sessions (UTC):
 * - Sydney: 21:00 - 06:00 UTC
 * - Tokyo: 00:00 - 09:00 UTC
 * - London: 07:00 - 16:00 UTC
 * - New York: 12:00 - 21:00 UTC
 * - London / NY Overlap: 12:00 - 16:00 UTC
 */
export function getForexSessionState(now: Date = new Date()): ForexSessionState {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const day = now.getUTCDay(); // 0 = Sun, 6 = Sat

  // Weekend check (Forex typically closes Friday ~21:00 UTC to Sunday ~21:00 UTC)
  const isWeekend = (day === 6) || (day === 0 && utcHours < 21) || (day === 5 && utcHours >= 21);

  if (isWeekend) {
    return {
      sydney: false,
      tokyo: false,
      london: false,
      newYork: false,
      isLondonNyOverlap: false,
      activeSessions: ['CLOSED (WEEKEND)']
    };
  }

  const sydney = (utcHours >= 21 || utcHours < 6);
  const tokyo = (utcHours >= 0 && utcHours < 9);
  const london = (utcHours >= 7 && utcHours < 16);
  const newYork = (utcHours >= 12 && utcHours < 21);
  const isLondonNyOverlap = (utcHours >= 12 && utcHours < 16);

  const activeSessions: string[] = [];
  if (isLondonNyOverlap) activeSessions.push('London/NY Overlap');
  else {
    if (london) activeSessions.push('London');
    if (newYork) activeSessions.push('New York');
  }
  if (tokyo) activeSessions.push('Tokyo');
  if (sydney) activeSessions.push('Sydney');

  if (activeSessions.length === 0) {
    activeSessions.push('Market Transition');
  }

  return {
    sydney,
    tokyo,
    london,
    newYork,
    isLondonNyOverlap,
    activeSessions
  };
}


