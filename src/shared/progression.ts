export type BestEntry = { readonly clacks: number; readonly finishTick: number };
export type StreakState = { readonly streak: number; readonly lastClearUtcDay: number | null };

export const LEADERBOARD_CLACK_MULTIPLIER = 1_000_000;
export const LEADERBOARD_MAX_TICK = 999_999;

function isPositiveSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sanitizeStreak(state: StreakState): StreakState {
  if (isPositiveSafeInteger(state.streak) && isPositiveSafeInteger(state.lastClearUtcDay)) {
    return state;
  }
  return { streak: 0, lastClearUtcDay: null };
}

export function evaluateStreakOnClear(prev: StreakState, currentUtcDay: number): StreakState {
  const state = sanitizeStreak(prev);
  if (!isPositiveSafeInteger(currentUtcDay)) return state;

  const lastDay = state.lastClearUtcDay;
  if (lastDay === null) return { streak: 1, lastClearUtcDay: currentUtcDay };
  const elapsedDays = currentUtcDay - lastDay;
  if (elapsedDays <= 0) return state;

  const streak = elapsedDays === 1 ? Math.min(state.streak + 1, Number.MAX_SAFE_INTEGER) : 1;
  return { streak, lastClearUtcDay: currentUtcDay };
}

export function getEffectiveStreak(state: StreakState, currentUtcDay: number): number {
  const { streak, lastClearUtcDay } = sanitizeStreak(state);
  if (lastClearUtcDay === null || !isPositiveSafeInteger(currentUtcDay)) return 0;
  const elapsedDays = currentUtcDay - lastClearUtcDay;
  return elapsedDays === 0 || elapsedDays === 1 ? streak : 0;
}

/** Throws RangeError when either component or the packed score is unsafe. */
export function computeCompositeScore(clacks: number, finishTick: number): number {
  if (!isNonNegativeSafeInteger(clacks) || !isNonNegativeSafeInteger(finishTick)) {
    throw new RangeError('Clacks and finish tick must be non-negative safe integers');
  }
  const score = clacks * LEADERBOARD_CLACK_MULTIPLIER + Math.min(LEADERBOARD_MAX_TICK, finishTick);
  if (!Number.isSafeInteger(score)) throw new RangeError('Composite score exceeds the safe integer range');
  return Math.abs(score);
}

export function decodeCompositeScore(score: number): BestEntry | null {
  if (!isNonNegativeSafeInteger(score)) return null;
  const normalized = Math.abs(score);
  const finishTick = normalized % LEADERBOARD_CLACK_MULTIPLIER;
  return { clacks: (normalized - finishTick) / LEADERBOARD_CLACK_MULTIPLIER, finishTick };
}

export function isBetterRun(previous: BestEntry | null, candidate: BestEntry): boolean {
  return previous === null ||
    computeCompositeScore(candidate.clacks, candidate.finishTick) <
      computeCompositeScore(previous.clacks, previous.finishTick);
}

export function computeTopPercent(rankZeroBased: number, totalPlayers: number): number | null {
  if (!Number.isInteger(rankZeroBased) || !Number.isInteger(totalPlayers) ||
      totalPlayers <= 0 || rankZeroBased < 0 || rankZeroBased >= totalPlayers) {
    return null;
  }
  // Round the rational percentage up without floating-point boundary errors.
  const total = BigInt(totalPlayers);
  const rank = BigInt(rankZeroBased) + 1n;
  return Number((rank * 100n + total - 1n) / total);
}

export function encodeBestEntry(clacks: number, finishTick: number): string {
  if (!isNonNegativeSafeInteger(clacks) || !isNonNegativeSafeInteger(finishTick)) {
    throw new RangeError('Clacks and finish tick must be non-negative safe integers');
  }
  return `${clacks}:${finishTick}`;
}

export function parseBestEntry(raw: string | undefined): BestEntry | null {
  if (typeof raw !== 'string' || !/^[0-9]+:[0-9]+$/.test(raw)) return null;
  const [clacksText, finishTickText] = raw.split(':');
  const clacks = Number(clacksText);
  const finishTick = Number(finishTickText);
  return isNonNegativeSafeInteger(clacks) && isNonNegativeSafeInteger(finishTick)
    ? { clacks, finishTick }
    : null;
}
