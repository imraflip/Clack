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
};

export type RunSubmissionRequest = {
  readonly day: number;
  readonly clackTicks: readonly number[];
  readonly endTick: number;
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
};

export type ApiErrorResponse = {
  readonly status: 'error';
  readonly message: string;
};

// ---------------------------------------------------------------------------
// Cast-free runtime guards shared by client and server
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function readDayList(value: unknown): number[] {
  const out: number[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (isNonNegativeInt(item) && item >= 1) out.push(item);
  }
  return out;
}

export function isCommunityDayStats(value: unknown): value is CommunityDayStats {
  if (!isRecord(value)) return false;
  const rate = Reflect.get(value, 'parRatePercent');
  return (
    isNonNegativeInt(Reflect.get(value, 'totalClears')) &&
    isNonNegativeInt(Reflect.get(value, 'parClears')) &&
    (rate === null || typeof rate === 'number')
  );
}

export function isDayResponse(value: unknown): value is DayResponse {
  if (!isRecord(value)) return false;
  const day = Reflect.get(value, 'day');
  const level = Reflect.get(value, 'level');
  return (
    isNonNegativeInt(day) &&
    isRecord(level) &&
    typeof Reflect.get(level, 'id') === 'string' &&
    Array.isArray(Reflect.get(value, 'completedDays')) &&
    isCommunityDayStats(Reflect.get(value, 'communityStats'))
  );
}

export function isRunSubmissionResponse(value: unknown): value is RunSubmissionResponse {
  if (!isRecord(value)) return false;
  return (
    Reflect.get(value, 'verified') === true &&
    isNonNegativeInt(Reflect.get(value, 'day')) &&
    typeof Reflect.get(value, 'won') === 'boolean' &&
    isNonNegativeInt(Reflect.get(value, 'clacks')) &&
    Array.isArray(Reflect.get(value, 'completedDays')) &&
    isCommunityDayStats(Reflect.get(value, 'communityStats'))
  );
}

/**
 * Strictly validates an untrusted run payload. Returns null on any violation:
 * non-integer day, non-array / oversize clackTicks, negative / float / NaN ticks,
 * or an endTick outside [0, MAX_REPLAY_TICKS].
 */
export function parseRunSubmissionRequest(body: unknown): RunSubmissionRequest | null {
  if (!isRecord(body)) return null;

  const day = Reflect.get(body, 'day');
  const clackTicksVal = Reflect.get(body, 'clackTicks');
  const endTick = Reflect.get(body, 'endTick');

  if (typeof day !== 'number' || !Number.isInteger(day)) return null;
  if (!isNonNegativeInt(endTick) || endTick > MAX_REPLAY_TICKS) return null;
  if (!Array.isArray(clackTicksVal) || clackTicksVal.length > MAX_CLACK_EVENTS) return null;

  const clackTicks: number[] = [];
  for (const item of clackTicksVal) {
    if (!isNonNegativeInt(item)) return null;
    clackTicks.push(item);
  }

  return { day, clackTicks, endTick };
}
