import type { BiomeId, IslandId, LevelDef } from './levels';
import type { SimPhase } from './sim';
import { SIM_HZ } from './sim';

/** Hard replay bounds enforced by POST /api/run. */
export const MAX_CLACK_EVENTS = 256;
export const MAX_REPLAY_TICKS = SIM_HZ * 60;

export type HealthResponse = {
  readonly status: 'ok';
  readonly dailyCount: number;
  readonly vaultCount: number;
  readonly activeUtcDay: number;
};

export type DaySummary = {
  readonly id: IslandId;
  readonly day: number;
  readonly name: string;
  readonly shortLabel: string;
  readonly par: number;
  readonly biome: BiomeId;
  readonly dotColor: string;
};

export type CommunityDayStats = {
  readonly totalClears: number;
  readonly parClears: number;
  readonly parRatePercent: number | null;
};

export type DayResponse = {
  readonly day: number;
  readonly level: LevelDef;
  readonly allDays: readonly DaySummary[];
  readonly completedDays: readonly number[];
  readonly bestClacksByDay: Readonly<Record<number, number>>;
  readonly userBestClacks: number | null;
  readonly userCleared: boolean;
  readonly communityStats: CommunityDayStats;
  readonly streak: number;
  readonly userRank: number | null;
  readonly totalPlayers: number;
};

export type RunSubmissionRequest = {
  readonly day: number;
  readonly clackTicks: readonly number[];
  readonly endTick: number;
  readonly runCount?: number;
};

export type RunSubmissionResponse = {
  readonly verified: true;
  readonly day: number;
  readonly islandId: IslandId;
  readonly won: boolean;
  readonly phase: SimPhase;
  readonly clacks: number;
  readonly par: number;
  readonly finishTick: number;
  readonly hash: string;
  readonly bestClacks: number | null;
  readonly isNewBest: boolean;
  readonly completedDays: readonly number[];
  readonly communityStats: CommunityDayStats;
  readonly streak: number;
  readonly rank: number | null;
  readonly percentile: number | null;
  readonly totalPlayers: number;
};

export type ApiErrorResponse = {
  readonly status: 'error';
  readonly message: string;
};

// ---------------------------------------------------------------------------
// Cast-free runtime guards shared by client and server
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return isNonNegativeInt(value) && value > 0;
}

function isNullableRank(value: unknown): boolean {
  return value === null || isPositiveInt(value);
}

export function readDayList(value: unknown): number[] {
  const out: number[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (isPositiveInt(item)) out.push(item);
  }
  return out;
}

export function isCommunityDayStats(value: unknown): value is CommunityDayStats {
  if (!isRecord(value)) return false;
  const rate = Reflect.get(value, 'parRatePercent');
  return (
    isNonNegativeInt(Reflect.get(value, 'totalClears')) &&
    isNonNegativeInt(Reflect.get(value, 'parClears')) &&
    (rate === null || (isNonNegativeInt(rate) && rate <= 100))
  );
}

export function isDayResponse(value: unknown): value is DayResponse {
  if (!isRecord(value)) return false;
  const day = Reflect.get(value, 'day');
  const level = Reflect.get(value, 'level');
  return (
    isPositiveInt(day) &&
    isRecord(level) &&
    typeof Reflect.get(level, 'id') === 'string' &&
    Array.isArray(Reflect.get(value, 'completedDays')) &&
    isCommunityDayStats(Reflect.get(value, 'communityStats')) &&
    isNonNegativeInt(Reflect.get(value, 'streak')) &&
    isNullableRank(Reflect.get(value, 'userRank')) &&
    isNonNegativeInt(Reflect.get(value, 'totalPlayers'))
  );
}

export function isRunSubmissionResponse(value: unknown): value is RunSubmissionResponse {
  if (!isRecord(value)) return false;
  const percentile = Reflect.get(value, 'percentile');
  return (
    Reflect.get(value, 'verified') === true &&
    isPositiveInt(Reflect.get(value, 'day')) &&
    typeof Reflect.get(value, 'won') === 'boolean' &&
    isNonNegativeInt(Reflect.get(value, 'clacks')) &&
    Array.isArray(Reflect.get(value, 'completedDays')) &&
    isCommunityDayStats(Reflect.get(value, 'communityStats')) &&
    isNonNegativeInt(Reflect.get(value, 'streak')) &&
    isNullableRank(Reflect.get(value, 'rank')) &&
    (percentile === null || (isPositiveInt(percentile) && percentile <= 100)) &&
    isNonNegativeInt(Reflect.get(value, 'totalPlayers'))
  );
}

export function parseDayQuery(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const day = Number(raw);
  return isPositiveInt(day) ? day : null;
}

/** Validates the replay envelope independently of where the replay ends. */
export function parseRunSubmissionRequest(body: unknown): RunSubmissionRequest | null {
  if (!isRecord(body)) return null;
  if (['__proto__', 'constructor', 'prototype'].some((key) => Object.hasOwn(body, key))) {
    return null;
  }
  if (!['day', 'clackTicks', 'endTick'].every((key) => Object.hasOwn(body, key))) return null;

  const day = Reflect.get(body, 'day');
  const clackTicksVal = Reflect.get(body, 'clackTicks');
  const endTick = Reflect.get(body, 'endTick');

  if (!isPositiveInt(day)) return null;
  if (!isNonNegativeInt(endTick) || endTick > MAX_REPLAY_TICKS) return null;
  if (!Array.isArray(clackTicksVal) || clackTicksVal.length > MAX_CLACK_EVENTS) return null;

  const clackTicks: number[] = [];
  for (const item of clackTicksVal) {
    if (!isNonNegativeInt(item) || item > MAX_REPLAY_TICKS) return null;
    // `+ 0` canonicalizes JSON `-0` to `0` so parsed ticks are sign-stable.
    clackTicks.push(item + 0);
  }
  const canonicalEndTick = endTick + 0;

  if (!Object.hasOwn(body, 'runCount')) return { day, clackTicks, endTick: canonicalEndTick };
  const runCount = Reflect.get(body, 'runCount');
  return isPositiveInt(runCount)
    ? { day, clackTicks, endTick: canonicalEndTick, runCount }
    : null;
}
