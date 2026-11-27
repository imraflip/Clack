import { context, redis } from '@devvit/web/server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type {
  ApiErrorResponse,
  CommunityDayStats,
  DayResponse,
  DaySummary,
  HealthResponse,
  RunSubmissionResponse,
} from '../../shared/api';
import { parseRunSubmissionRequest } from '../../shared/api';
import { getIslandByDay, ISLANDS } from '../../shared/levels';
import { simulate } from '../../shared/sim';
import {
  getActiveUtcDay,
  hasDevvitContext,
  readBoundPostDay,
  resolveCatalogueDay,
} from '../core/post';

// ---------------------------------------------------------------------------
// Redis hash access with an in-memory fallback used only outside a Devvit
// request context (unit tests / local preview). Inside Devvit, Redis errors
// propagate instead of silently diverging into process memory.
// ---------------------------------------------------------------------------

const fallbackHashes = new Map<string, Map<string, string>>();

function fallbackHash(key: string): Map<string, string> {
  let hash = fallbackHashes.get(key);
  if (!hash) {
    hash = new Map<string, string>();
    fallbackHashes.set(key, hash);
  }
  return hash;
}

async function hashGetAll(key: string): Promise<Record<string, string>> {
  if (hasDevvitContext()) return await redis.hGetAll(key);
  return Object.fromEntries(fallbackHashes.get(key) ?? []);
}

function incrementFallbackStat(key: string, field: string): void {
  const hash = fallbackHash(key);
  hash.set(field, String((Number(hash.get(field) ?? '0') || 0) + 1));
}

/** Test-only reset of the in-memory fallback store. */
export function resetFallbackStore(): void {
  fallbackHashes.clear();
}

// ---------------------------------------------------------------------------
// clack:v2 key schema
// ---------------------------------------------------------------------------

const statsKey = (day: number): string => `clack:v2:stats:day:${day}`;
const bestsKey = (userId: string): string => `clack:v2:user:${userId}:bests`;
const bestField = (day: number): string => `day:${day}`;

/**
 * Stable per-user scope. Logged-out Reddit viewers get null (nothing persisted);
 * outside Devvit a single 'local' scope backs the in-memory fallback.
 */
function resolveUserScope(): string | null {
  if (!hasDevvitContext()) return 'local';
  return context.userId ?? null;
}

type BestEntry = { readonly clacks: number; readonly finishTick: number };

function parseBest(raw: string | undefined): BestEntry | null {
  if (raw === undefined) return null;
  const [clacksRaw, tickRaw] = raw.split(':');
  const clacks = Number(clacksRaw);
  const finishTick = Number(tickRaw);
  if (!Number.isInteger(clacks) || clacks < 0) return null;
  return { clacks, finishTick: Number.isInteger(finishTick) ? finishTick : 0 };
}

function improveBest(previous: BestEntry | null, candidate: BestEntry): boolean {
  return (
    previous === null ||
    candidate.clacks < previous.clacks ||
    (candidate.clacks === previous.clacks && candidate.finishTick < previous.finishTick)
  );
}

async function recordClear(
  userScope: string,
  day: number,
  par: number,
  candidate: BestEntry
): Promise<boolean | null> {
  const key = bestsKey(userScope);
  const field = bestField(day);
  const stats = statsKey(day);
  const encoded = `${candidate.clacks}:${candidate.finishTick}`;
  const isFirstPar = (previous: BestEntry | null): boolean =>
    candidate.clacks <= par && (previous === null || previous.clacks > par);

  if (!hasDevvitContext()) {
    const hash = fallbackHash(key);
    const previous = parseBest(hash.get(field));
    if (!improveBest(previous, candidate)) return false;
    hash.set(field, encoded);
    if (previous === null) incrementFallbackStat(stats, 'clears');
    if (isFirstPar(previous)) incrementFallbackStat(stats, 'parClears');
    return previous === null || candidate.clacks < previous.clacks;
  }

  // A conflict retries the read so concurrent submissions cannot overwrite a
  // better run or count a first clear twice, even across server instances.
  for (let attempt = 0; attempt < 5; attempt++) {
    const tx = await redis.watch(key);
    let started = false;
    let executing = false;
    try {
      const previous = parseBest(await redis.hGet(key, field));
      if (!improveBest(previous, candidate)) return false;
      await tx.multi();
      started = true;
      await tx.hSet(key, { [field]: encoded });
      if (previous === null) await tx.hIncrBy(stats, 'clears', 1);
      if (isFirstPar(previous)) await tx.hIncrBy(stats, 'parClears', 1);
      executing = true;
      const [written]: unknown[] = await tx.exec();
      if (typeof written === 'number') {
        return previous === null || candidate.clacks < previous.clacks;
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

type UserProgress = {
  readonly completedDays: readonly number[];
  readonly bestClacksByDay: Readonly<Record<number, number>>;
};

async function readUserProgress(userScope: string | null): Promise<UserProgress> {
  const completedDays: number[] = [];
  const bestClacksByDay: Record<number, number> = {};
  if (userScope === null) return { completedDays, bestClacksByDay };

  const bests = await hashGetAll(bestsKey(userScope));
  for (const island of ISLANDS) {
    const best = parseBest(bests[bestField(island.day)]);
    if (best) {
      completedDays.push(island.day);
      bestClacksByDay[island.day] = best.clacks;
    }
  }
  return { completedDays, bestClacksByDay };
}

async function readCommunityStats(day: number): Promise<CommunityDayStats> {
  const stats = await hashGetAll(statsKey(day));
  const totalClears = Math.max(0, Number.parseInt(stats['clears'] ?? '0', 10) || 0);
  const parClears = Math.min(
    totalClears,
    Math.max(0, Number.parseInt(stats['parClears'] ?? '0', 10) || 0)
  );
  const parRatePercent = totalClears > 0 ? Math.round((parClears / totalClears) * 100) : null;
  return { totalClears, parClears, parRatePercent };
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
  let day: number;
  if (dayParam !== undefined) {
    const parsed = Number(dayParam);
    if (!/^[0-9]+$/.test(dayParam) || !getIslandByDay(parsed)) {
      return c.json<ApiErrorResponse>(errorJson(`Unknown day ${dayParam}`), 404);
    }
    day = parsed;
  } else {
    day = (await readBoundPostDay()) ?? resolveCatalogueDay(getActiveUtcDay());
  }

  const level = getIslandByDay(day);
  if (!level) {
    return c.json<ApiErrorResponse>(errorJson(`Unknown day ${day}`), 404);
  }

  const userScope = resolveUserScope();
  const [progress, communityStats] = await Promise.all([
    readUserProgress(userScope),
    readCommunityStats(level.day),
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

  const userScope = resolveUserScope();
  let isNewBest = false;
  if (result.won && userScope !== null) {
    const saved = await recordClear(userScope, level.day, level.par, result);
    if (saved === null) {
      return c.json<ApiErrorResponse>(errorJson('Replay save is busy, please retry'), 503);
    }
    isNewBest = saved;
  }

  const [progress, communityStats] = await Promise.all([
    readUserProgress(userScope),
    readCommunityStats(level.day),
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
  });
});
