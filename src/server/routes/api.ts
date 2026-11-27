import { context } from '@devvit/web/server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type {
  ApiErrorResponse,
  DayResponse,
  DaySummary,
  HealthResponse,
  RunSubmissionResponse,
} from '../../shared/api';
import { parseDayQuery, parseRunSubmissionRequest } from '../../shared/api';
import { getIslandByDay, ISLANDS } from '../../shared/levels';
import { simulate } from '../../shared/sim';
import { hasDevvitContext } from '../core/kv';
import { getActiveUtcDay, readBoundPostDay, resolveCatalogueDay } from '../core/post';
import {
  readCommunityStats,
  readDayPlacement,
  readUserProgress,
  recordVerifiedClear,
} from '../core/progression';

export { resetFallbackStore } from '../core/kv';

/**
 * Stable per-user scope. Logged-out Reddit viewers get null (nothing persisted);
 * outside Devvit a single 'local' scope backs the in-memory fallback.
 */
function resolveUserScope(): string | null {
  if (!hasDevvitContext()) return 'local';
  return context.userId ?? null;
}

const ALL_DAY_SUMMARIES: readonly DaySummary[] = ISLANDS.map((island) => ({
  id: island.id,
  day: island.day,
  name: island.name,
  shortLabel: island.shortLabel,
  par: island.par,
  biome: island.biome,
  dotColor: island.dotColor,
}));

function errorJson(message: string): ApiErrorResponse {
  return { status: 'error', message };
}

export const api = new Hono();

api.get('/health', (c) => {
  return c.json<HealthResponse>({
    status: 'ok',
    dailyCount: ISLANDS.filter((island) => island.category === 'daily').length,
    vaultCount: ISLANDS.filter((island) => island.category === 'vault').length,
    activeUtcDay: getActiveUtcDay(),
  });
});

api.get('/day', async (c) => {
  const dayParam = c.req.query('day');
  const utcDay = getActiveUtcDay();
  let day: number;
  if (dayParam !== undefined) {
    const parsed = parseDayQuery(dayParam);
    if (parsed === null || !getIslandByDay(parsed)) {
      return c.json<ApiErrorResponse>(errorJson(`Unknown day ${dayParam}`), 404);
    }
    day = parsed;
  } else {
    day = (await readBoundPostDay()) ?? resolveCatalogueDay(utcDay);
  }

  const level = getIslandByDay(day);
  if (!level) {
    return c.json<ApiErrorResponse>(errorJson(`Unknown day ${day}`), 404);
  }

  const userScope = resolveUserScope();
  const [progress, communityStats, placement] = await Promise.all([
    readUserProgress(userScope, utcDay),
    readCommunityStats(level.day),
    readDayPlacement(userScope, level.day),
  ]);
  const userBestClacks = progress.bestClacksByDay[level.day] ?? null;

  return c.json<DayResponse>({
    day: level.day,
    level,
    allDays: ALL_DAY_SUMMARIES,
    completedDays: progress.completedDays,
    bestClacksByDay: progress.bestClacksByDay,
    userBestClacks,
    userCleared: userBestClacks !== null,
    communityStats,
    streak: progress.streak,
    userRank: placement.rank,
    totalPlayers: placement.totalPlayers,
  });
});

api.post('/run', bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) => c.json<ApiErrorResponse>(errorJson('Replay request body is too large'), 413),
}), async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json<ApiErrorResponse>(errorJson('Invalid JSON request body'), 400);
  }

  const parsed = parseRunSubmissionRequest(rawBody);
  if (!parsed) {
    return c.json<ApiErrorResponse>(
      errorJson(
        'Request must include integer day, <= 256 non-negative integer clackTicks, and endTick in [0, 7200]'
      ),
      400
    );
  }

  const level = getIslandByDay(parsed.day);
  if (!level) {
    return c.json<ApiErrorResponse>(errorJson(`Unknown day ${parsed.day}`), 404);
  }

  // Authoritative replay: the client's claimed outcome is never trusted.
  const result = simulate(level, parsed.clackTicks, parsed.endTick);
  const utcDay = getActiveUtcDay();

  const userScope = resolveUserScope();
  let isNewBest = false;
  if (result.won && userScope !== null) {
    const saved = await recordVerifiedClear(userScope, level.day, level.par, utcDay, {
      clacks: result.clacks,
      finishTick: result.finishTick,
    });
    if (saved === null) {
      return c.json<ApiErrorResponse>(errorJson('Replay save is busy, please retry'), 503);
    }
    isNewBest = saved.isNewBest;
  }

  const [progress, communityStats, placement] = await Promise.all([
    readUserProgress(userScope, utcDay),
    readCommunityStats(level.day),
    readDayPlacement(userScope, level.day),
  ]);

  return c.json<RunSubmissionResponse>({
    verified: true,
    day: level.day,
    islandId: level.id,
    won: result.won,
    phase: result.state.phase,
    clacks: result.clacks,
    par: level.par,
    finishTick: result.finishTick,
    hash: result.hash,
    bestClacks: progress.bestClacksByDay[level.day] ?? null,
    isNewBest,
    completedDays: progress.completedDays,
    communityStats,
    streak: progress.streak,
    rank: placement.rank,
    percentile: placement.percentile,
    totalPlayers: placement.totalPlayers,
  });
});
