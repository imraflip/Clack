import type { CommunityDayStats } from '../../shared/api';
import { ISLANDS } from '../../shared/levels';
import type { BestEntry, StreakState } from '../../shared/progression';
import {
  computeCompositeScore,
  computeTopPercent,
  encodeBestEntry,
  evaluateStreakOnClear,
  getEffectiveStreak,
  isBetterRun,
  parseBestEntry,
} from '../../shared/progression';
import {
  dayLeaderboardKey,
  dayStatsKey,
  hGet,
  hGetAll,
  userBestsKey,
  userProfileKey,
  watch,
  zCard,
  zRank,
  zScore,
} from './kv';

const MAX_COMMIT_ATTEMPTS = 5;

function bestField(day: number): string {
  return `day:${day}`;
}

/** Strict non-negative integer read of a stored counter; anything else is 0. */
function readCounter(raw: string | undefined): number {
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : 0;
}

function readStreakState(profile: Readonly<Record<string, string>>): StreakState {
  const lastClearUtcDay = readCounter(profile['lastClearUtcDay']);
  return {
    streak: readCounter(profile['streak']),
    lastClearUtcDay: lastClearUtcDay > 0 ? lastClearUtcDay : null,
  };
}

async function readClearTotals(
  bestsKey: string,
  profile: Readonly<Record<string, string>>
): Promise<{ totalClears: number; totalParClears: number }> {
  const totalClears = profile['totalClears'];
  const totalParClears = profile['totalParClears'];
  if (totalClears !== undefined && totalParClears !== undefined) {
    return { totalClears: readCounter(totalClears), totalParClears: readCounter(totalParClears) };
  }

  // Earlier releases recorded bests and community counters before profiles existed.
  const bests = await hGetAll(bestsKey);
  let clears = 0;
  let parClears = 0;
  for (const island of ISLANDS) {
    const best = parseBestEntry(bests[bestField(island.day)]);
    if (!best) continue;
    clears++;
    if (best.clacks <= island.par) parClears++;
  }
  return {
    totalClears: totalClears === undefined ? clears : readCounter(totalClears),
    totalParClears: totalParClears === undefined ? parClears : readCounter(totalParClears),
  };
}

export type VerifiedClearResult = {
  readonly isNewBest: boolean;
  readonly streak: number;
};

/**
 * Persists one server-verified winning replay. Best/leaderboard/stats only move
 * when the run improves the player's best, while the UTC streak advances on any
 * verified clear on a new UTC day. Only bounded integers are written.
 *
 * Returns null when every optimistic commit attempt lost a WATCH race.
 */
export async function recordVerifiedClear(
  userId: string,
  day: number,
  par: number,
  utcDay: number,
  candidate: BestEntry
): Promise<VerifiedClearResult | null> {
  const bestsKey = userBestsKey(userId);
  const profileKey = userProfileKey(userId);
  const field = bestField(day);
  const leaderboardKey = dayLeaderboardKey(day);

  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const tx = await watch(bestsKey, profileKey);
    let started = false;
    let executing = false;
    try {
      const [rawBest, profile] = await Promise.all([hGet(bestsKey, field), hGetAll(profileKey)]);
      const previous = parseBestEntry(rawBest);
      const improved = isBetterRun(previous, candidate);
      const prevStreak = readStreakState(profile);
      const nextStreak = evaluateStreakOnClear(prevStreak, utcDay);
      const streakChanged =
        nextStreak.streak !== prevStreak.streak ||
        nextStreak.lastClearUtcDay !== prevStreak.lastClearUtcDay;
      const streak = getEffectiveStreak(nextStreak, utcDay);

      // A pre-leaderboard best still owns the score if the new run is slower.
      const rankedBest = improved ? candidate : previous;
      const needsRank = !improved && (await zScore(leaderboardKey, userId)) == null;
      if (!improved && !streakChanged && !needsRank) return { isNewBest: false, streak };

      const isFirstClear = previous === null;
      const isFirstPar = candidate.clacks <= par && (previous === null || previous.clacks > par);
      const totals = await readClearTotals(bestsKey, profile);

      await tx.multi();
      started = true;
      if (improved) {
        await tx.hSet(bestsKey, { [field]: encodeBestEntry(candidate.clacks, candidate.finishTick) });
      }
      if ((improved || needsRank) && rankedBest) {
        await tx.zAdd(
          leaderboardKey,
          userId,
          computeCompositeScore(rankedBest.clacks, rankedBest.finishTick)
        );
      }
      if (isFirstClear) await tx.hIncrBy(dayStatsKey(day), 'clears', 1);
      if (isFirstPar) await tx.hIncrBy(dayStatsKey(day), 'parClears', 1);
      await tx.hSet(profileKey, {
        streak: String(nextStreak.streak),
        lastClearUtcDay: String(nextStreak.lastClearUtcDay ?? 0),
        totalClears: String(totals.totalClears + (isFirstClear ? 1 : 0)),
        totalParClears: String(totals.totalParClears + (isFirstPar ? 1 : 0)),
      });
      executing = true;
      if (await tx.exec()) {
        return { isNewBest: isFirstClear || candidate.clacks < previous.clacks, streak };
      }
    } finally {
      if (!executing) {
        if (started) await tx.discard();
        else await tx.unwatch();
      }
    }
  }
  return null;
}

export type UserProgress = {
  readonly completedDays: readonly number[];
  readonly bestClacksByDay: Readonly<Record<number, number>>;
  readonly streak: number;
};

export async function readUserProgress(userId: string | null, utcDay: number): Promise<UserProgress> {
  const completedDays: number[] = [];
  const bestClacksByDay: Record<number, number> = {};
  if (userId === null) return { completedDays, bestClacksByDay, streak: 0 };

  const [bests, profile] = await Promise.all([
    hGetAll(userBestsKey(userId)),
    hGetAll(userProfileKey(userId)),
  ]);
  for (const island of ISLANDS) {
    const best = parseBestEntry(bests[bestField(island.day)]);
    if (best) {
      completedDays.push(island.day);
      bestClacksByDay[island.day] = best.clacks;
    }
  }
  return {
    completedDays,
    bestClacksByDay,
    streak: getEffectiveStreak(readStreakState(profile), utcDay),
  };
}

export type DayPlacement = {
  /** 1-based leaderboard rank, null when unranked or anonymous. */
  readonly rank: number | null;
  /** Top X% (1..100), null when unranked or anonymous. */
  readonly percentile: number | null;
  readonly totalPlayers: number;
};

export async function readDayPlacement(userId: string | null, day: number): Promise<DayPlacement> {
  const key = dayLeaderboardKey(day);
  const [totalPlayers, rankZeroBased] = await Promise.all([
    zCard(key),
    userId === null ? Promise.resolve(undefined) : zRank(key, userId),
  ]);
  if (rankZeroBased === undefined) return { rank: null, percentile: null, totalPlayers };
  const percentile = computeTopPercent(rankZeroBased, totalPlayers);
  return {
    rank: percentile === null ? null : rankZeroBased + 1,
    percentile,
    totalPlayers,
  };
}

export async function readCommunityStats(day: number): Promise<CommunityDayStats> {
  const stats = await hGetAll(dayStatsKey(day));
  const totalClears = readCounter(stats['clears']);
  const parClears = Math.min(totalClears, readCounter(stats['parClears']));
  const parRatePercent = totalClears > 0 ? Math.round((parClears / totalClears) * 100) : null;
  return { totalClears, parClears, parRatePercent };
}
