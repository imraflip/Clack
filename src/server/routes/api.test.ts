import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../../../devvit.json' with { type: 'json' };
import { MAX_CLACK_EVENTS, MAX_REPLAY_TICKS } from '../../shared/api';
import { computeCompositeScore } from '../../shared/progression';
import { simulate } from '../../shared/sim';
import { getIslandByDay } from '../../shared/levels';
import { SIM_HZ } from '../../shared/sim';
import * as kv from '../core/kv';
import { getActiveUtcDay, resolveCatalogueDay } from '../core/post';
import { api, resetFallbackStore } from './api';
import { menu } from './menu';
import { scheduler } from './scheduler';
import { triggers } from './triggers';

const devvit = vi.hoisted(() => ({
  context: new Map<string, string>(),
  redis: {
    get: vi.fn<(key: string) => Promise<string | undefined>>(),
    set: vi.fn(),
    del: vi.fn(),
    hGet: vi.fn<(key: string, field: string) => Promise<string | undefined>>(),
    hGetAll: vi.fn<(key: string) => Promise<Record<string, string>>>(),
    hSet: vi.fn(),
    hIncrBy: vi.fn(),
    zAdd: vi.fn(),
    zRank: vi.fn<(key: string, member: string) => Promise<number | undefined>>(),
    zCard: vi.fn<(key: string) => Promise<number>>(),
    zScore: vi.fn(),
    watch: vi.fn(),
  },
  reddit: {
    submitCustomPost: vi.fn<(opts: { title: string }) => Promise<{ id: string }>>(),
  },
}));
vi.mock('@devvit/web/server', () => ({
  redis: devvit.redis,
  reddit: devvit.reddit,
  context: {
    get subredditId() { return devvit.context.get('subredditId'); },
    get subredditName() { return devvit.context.get('subredditName') ?? 'clack_test'; },
    get userId() { return devvit.context.get('userId'); },
    get postId() { return devvit.context.get('postId'); },
  },
}));

function mockTx(exec: ReturnType<typeof vi.fn>): Record<string, ReturnType<typeof vi.fn>> {
  return {
    multi: vi.fn(),
    hSet: vi.fn(),
    hIncrBy: vi.fn(),
    zAdd: vi.fn(),
    exec,
    discard: vi.fn(),
    unwatch: vi.fn(),
  };
}

const CEDAR_PAR = [300, 1120];

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected JSON object body');
  }
  return Object.fromEntries(Object.entries(body));
}

function postRun(payload: unknown): Promise<Response> {
  return Promise.resolve(
    api.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    })
  );
}

describe('Clack Hono API', () => {
  beforeEach(() => {
    resetFallbackStore();
    devvit.context.clear();
    vi.resetAllMocks();
    devvit.redis.zCard.mockResolvedValue(0);
    devvit.redis.zRank.mockResolvedValue(undefined);
  });

  it('returns diagnostics on GET /health', async () => {
    const res = await api.request('/health');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toEqual({
      status: 'ok',
      dailyCount: 5,
      vaultCount: 0,
      activeUtcDay: getActiveUtcDay(),
    });
  });

  it('returns level data and all 5 day summaries on GET /day?day=3', async () => {
    const res = await api.request('/day?day=3');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body['day']).toBe(3);
    const level = body['level'];
    expect(typeof level === 'object' && level !== null).toBe(true);
    if (typeof level === 'object' && level !== null) {
      expect(Reflect.get(level, 'id')).toBe('amber');
      expect(Reflect.get(level, 'par')).toBe(3);
    }
    expect(body['allDays']).toHaveLength(5);
    expect(body['completedDays']).toEqual([]);
    expect(body['userBestClacks']).toBeNull();
    expect(body['userCleared']).toBe(false);
    expect(body['communityStats']).toEqual({ totalClears: 0, parClears: 0, parRatePercent: null });
  });

  it('defaults GET /day to the active UTC catalogue day', async () => {
    const res = await api.request('/day');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body['day']).toBe(resolveCatalogueDay(getActiveUtcDay()));
  });

  it('uses the trusted post binding for the default day', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.context.set('postId', 't3_test');
    devvit.redis.hGet.mockResolvedValue('4');
    devvit.redis.hGetAll.mockResolvedValue({});
    expect(await readJson(await api.request('/day'))).toMatchObject({ day: 4 });
    expect(devvit.redis.hGet).toHaveBeenCalledWith('clack:v2:meta:post:t3_test', 'day');
  });

  it('rejects unknown or malformed days on GET /day with 404', async () => {
    for (const q of ['0', '6', '-1', '1.5', 'abc', '1e0', '0x1', '%201']) {
      const res = await api.request(`/day?day=${q}`);
      expect(res.status).toBe(404);
    }
  });

  it('verifies a winning Par 2 run via deterministic replay on POST /run', async () => {
    const res = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body['verified']).toBe(true);
    expect(body['won']).toBe(true);
    expect(body['clacks']).toBe(2);
    expect(body['par']).toBe(2);
    expect(body['bestClacks']).toBe(2);
    expect(body['isNewBest']).toBe(true);
    expect(typeof body['hash']).toBe('string');
    expect(body['completedDays']).toEqual([1]);
    expect(body['communityStats']).toEqual({ totalClears: 1, parClears: 1, parRatePercent: 100 });
  });

  it('preserves bestClacks and counts each user once across repeat clears', async () => {
    await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    const worse = await readJson(
      await postRun({ day: 1, clackTicks: [10, 20, 300, 1120], endTick: SIM_HZ * 25 })
    );
    expect(worse['won']).toBe(true);
    expect(worse['clacks']).toBe(4);
    expect(worse['bestClacks']).toBe(2);
    expect(worse['isNewBest']).toBe(false);

    const again = await readJson(
      await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 })
    );
    expect(again['communityStats']).toEqual({ totalClears: 1, parClears: 1, parRatePercent: 100 });
  });

  it('counts a later par clear once after an over-par first clear', async () => {
    const first = await readJson(
      await postRun({ day: 1, clackTicks: [10, 20, 300, 1120], endTick: SIM_HZ * 25 })
    );
    expect(first['communityStats']).toEqual({ totalClears: 1, parClears: 0, parRatePercent: 0 });
    const par = await readJson(
      await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 })
    );
    expect(par['isNewBest']).toBe(true);
    expect(par['communityStats']).toEqual({ totalClears: 1, parClears: 1, parRatePercent: 100 });
  });

  it('never records forged or non-winning replays', async () => {
    const res = await postRun({ day: 1, clackTicks: [], endTick: SIM_HZ * 25 });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body['verified']).toBe(true);
    expect(body['won']).toBe(false);
    expect(body['bestClacks']).toBeNull();
    expect(body['completedDays']).toEqual([]);
    expect(body['communityStats']).toEqual({ totalClears: 0, parClears: 0, parRatePercent: null });
  });

  it('keeps a best run and counts each player once under overlapping submissions', async () => {
    const endTick = SIM_HZ * 25;
    await Promise.all([
      postRun({ day: 1, clackTicks: CEDAR_PAR, endTick }),
      postRun({ day: 1, clackTicks: [10, 20, ...CEDAR_PAR], endTick }),
      postRun({ day: 1, clackTicks: CEDAR_PAR, endTick }),
    ]);

    const body = await readJson(await api.request('/day?day=1'));
    expect(body['userBestClacks']).toBe(2);
    expect(body['communityStats']).toEqual({ totalClears: 1, parClears: 1, parRatePercent: 100 });
  });

  it('retries a conflicted Redis write against the newly committed best and counters', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.context.set('userId', 't2_test');
    const tx = mockTx(vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([0, 1, 1]));
    devvit.redis.watch.mockResolvedValue(tx);
    devvit.redis.hGet
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('4:1500');
    devvit.redis.hGetAll.mockImplementation(async (key): Promise<Record<string, string>> => {
      if (key === 'clack:v2:stats:day:1') return { clears: '1', parClears: '1' };
      if (key === 'clack:v2:user:t2_test:profile') return { streak: '1', lastClearUtcDay: String(getActiveUtcDay()) };
      return { 'day:1': '2:1500' };
    });
    devvit.redis.zCard.mockResolvedValue(1);
    devvit.redis.zRank.mockResolvedValue(0);

    const response = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(response.status).toBe(200);
    expect(devvit.redis.watch).toHaveBeenCalledTimes(2);
    expect(devvit.redis.watch).toHaveBeenCalledWith(
      'clack:v2:user:t2_test:bests',
      'clack:v2:user:t2_test:profile'
    );
    expect(tx['hIncrBy']?.mock.calls).toEqual([
      ['clack:v2:stats:day:1', 'clears', 1],
      ['clack:v2:stats:day:1', 'parClears', 1],
      ['clack:v2:stats:day:1', 'parClears', 1],
    ]);
    expect(tx['zAdd']?.mock.calls[0]?.[0]).toBe('clack:v2:lb:day:1');
    expect(tx['zAdd']?.mock.calls[0]?.[1]).toMatchObject({ member: 't2_test' });
    expect(tx['discard']).not.toHaveBeenCalled();
    expect(await readJson(response)).toMatchObject({
      bestClacks: 2,
      isNewBest: true,
      communityStats: { totalClears: 1, parClears: 1, parRatePercent: 100 },
      streak: 1,
      rank: 1,
      percentile: 100,
      totalPlayers: 1,
    });
  });

  it('returns a retryable status if Redis rejects every conditional commit', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.context.set('userId', 't2_test');
    devvit.redis.hGetAll.mockResolvedValue({});
    const exec = vi.fn().mockResolvedValue([]);
    devvit.redis.watch.mockResolvedValue(mockTx(exec));
    const response = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(response.status).toBe(503);
    expect(exec).toHaveBeenCalledTimes(5);
    expect(devvit.redis.zCard).not.toHaveBeenCalled();
  });

  it('unwatches without writing when a verified clear changes nothing', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.context.set('userId', 't2_test');
    const tx = mockTx(vi.fn());
    devvit.redis.watch.mockResolvedValue(tx);
    devvit.redis.hGet.mockResolvedValue('2:1');
    devvit.redis.hGetAll.mockResolvedValue({ streak: '3', lastClearUtcDay: String(getActiveUtcDay()) });
    devvit.redis.zScore.mockResolvedValue(2_000_001);
    const response = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(response.status).toBe(200);
    expect(tx['multi']).not.toHaveBeenCalled();
    expect(tx['exec']).not.toHaveBeenCalled();
    expect(tx['unwatch']).toHaveBeenCalledTimes(1);
    expect(await readJson(response)).toMatchObject({ isNewBest: false, streak: 3 });
  });

  it('verifies anonymous runs without recording bests or community clears', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.redis.hGetAll.mockResolvedValue({});
    const response = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(await readJson(response)).toMatchObject({
      won: true, bestClacks: null, completedDays: [], isNewBest: false,
      communityStats: { totalClears: 0, parClears: 0, parRatePercent: null },
      streak: 0, rank: null, percentile: null, totalPlayers: 0,
    });
    expect(devvit.redis.watch).not.toHaveBeenCalled();
    expect(devvit.redis.zRank).not.toHaveBeenCalled();
    expect(devvit.redis.hSet).not.toHaveBeenCalled();
  });

  it('discards claimed results and preserves an existing best on an incomplete replay', async () => {
    await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    const response = await postRun({
      day: 1, clackTicks: CEDAR_PAR, endTick: 1, won: true, clacks: 0, keysCollected: 3,
    });
    expect(await readJson(response)).toMatchObject({
      won: false, clacks: 0, bestClacks: 2, isNewBest: false, completedDays: [1],
      communityStats: { totalClears: 1, parClears: 1, parRatePercent: 100 },
    });
  });

  it('leaves authenticated Redis state untouched on a forged victory', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.context.set('userId', 't2_test');
    devvit.redis.hGetAll.mockResolvedValue({});
    const response = await postRun({
      day: 1, clackTicks: CEDAR_PAR, endTick: 1, won: true, clacks: 0, keysCollected: 3,
      streak: 99, rank: 1, note: 'client-supplied free text',
    });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      won: false, bestClacks: null, completedDays: [], streak: 0, rank: null,
    });
    expect(devvit.redis.watch).not.toHaveBeenCalled();
    expect(devvit.redis.hSet).not.toHaveBeenCalled();
    expect(devvit.redis.hIncrBy).not.toHaveBeenCalled();
    expect(devvit.redis.zAdd).not.toHaveBeenCalled();
    expect(devvit.redis.set).not.toHaveBeenCalled();
  });

  it('unwatches on a Redis read failure and discards a partially queued transaction', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.context.set('userId', 't2_test');
    const readFailure = mockTx(vi.fn());
    const queueFailure = mockTx(vi.fn());
    queueFailure['zAdd']?.mockRejectedValueOnce(new Error('Redis command unavailable'));
    devvit.redis.watch.mockResolvedValueOnce(readFailure).mockResolvedValueOnce(queueFailure);
    devvit.redis.hGet.mockRejectedValueOnce(new Error('Redis read unavailable'));
    devvit.redis.hGetAll.mockResolvedValue({});
    const replay = { day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 };

    expect((await postRun(replay)).status).toBe(500);
    expect(readFailure['unwatch']).toHaveBeenCalledTimes(1);
    expect(readFailure['multi']).not.toHaveBeenCalled();

    expect((await postRun(replay)).status).toBe(500);
    expect(queueFailure['hSet']).toHaveBeenCalledTimes(1);
    expect(queueFailure['discard']).toHaveBeenCalledTimes(1);
    expect(queueFailure['exec']).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies before decoding JSON', async () => {
    const response = await postRun(' '.repeat(17 * 1024));
    expect(response.status).toBe(413);
  });

  it('rejects malformed payloads with HTTP 400 on POST /run', async () => {
    const bad: unknown[] = [
      '{not json',
      '{"day":1,"clackTicks":[1e999],"endTick":10}',
      '{"day":1,"clackTicks":[NaN],"endTick":10}',
      '{"day":1,"clackTicks":[],"endTick":1e999}',
      { day: 'bad', clackTicks: [], endTick: 10 },
      { day: 0, clackTicks: [], endTick: 10 },
      { day: 1.5, clackTicks: [], endTick: 10 },
      { day: 1, clackTicks: 'x', endTick: 10 },
      { day: 1, clackTicks: [-1], endTick: 10 },
      { day: 1, clackTicks: [1.5], endTick: 10 },
      { day: 1, clackTicks: [null], endTick: 10 },
      { day: 1, clackTicks: [MAX_REPLAY_TICKS + 1], endTick: 10 },
      { day: 1, clackTicks: [], endTick: -1 },
      { day: 1, clackTicks: [], endTick: 2.5 },
      { day: 1, clackTicks: [], endTick: MAX_REPLAY_TICKS + 1 },
      { day: 1, clackTicks: [], endTick: null },
      { day: 1, clackTicks: Array.from({ length: MAX_CLACK_EVENTS + 1 }, (_, i) => i), endTick: 10 },
    ];
    for (const payload of bad) {
      const res = await postRun(payload);
      expect(res.status).toBe(400);
    }
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects reserved replay property %s', async (key) => {
    const response = await postRun({ day: 1, clackTicks: [], endTick: 10, [key]: null });
    expect(response.status).toBe(400);
  });

  it('returns 404 for unknown days on POST /run', async () => {
    const res = await postRun({ day: 99, clackTicks: [], endTick: 10 });
    expect(res.status).toBe(404);
  });
});

describe('Phase 3 progression: streaks and leaderboards', () => {
  beforeEach(() => {
    resetFallbackStore();
    devvit.context.clear();
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const utcNoon = (utcDay: number): number => Date.UTC(2026, 10, 27 + utcDay - 1, 12);
  const winCedar = async (): Promise<Record<string, unknown>> =>
    await readJson(await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 }));

  it('exposes streak, rank, and totalPlayers on GET /day and POST /run', async () => {
    vi.setSystemTime(utcNoon(3));
    const before = await readJson(await api.request('/day?day=1'));
    expect(before).toMatchObject({ streak: 0, userRank: null, totalPlayers: 0 });
    expect(await winCedar()).toMatchObject({ streak: 1, rank: 1, percentile: 100, totalPlayers: 1 });
    const after = await readJson(await api.request('/day?day=1'));
    expect(after).toMatchObject({ streak: 1, userRank: 1, totalPlayers: 1, bestClacksByDay: { 1: 2 } });
  });

  it('advances the UTC streak on consecutive days even without a new best, and resets after a gap', async () => {
    vi.setSystemTime(utcNoon(10));
    expect(await winCedar()).toMatchObject({ streak: 1, isNewBest: true });
    expect(await winCedar()).toMatchObject({ streak: 1, isNewBest: false });

    vi.setSystemTime(utcNoon(11));
    expect(await winCedar()).toMatchObject({ streak: 2, isNewBest: false });
    expect(await readJson(await api.request('/day?day=1'))).toMatchObject({ streak: 2 });

    vi.setSystemTime(utcNoon(12));
    expect(await readJson(await api.request('/day?day=1'))).toMatchObject({ streak: 2 });

    vi.setSystemTime(utcNoon(13));
    expect(await readJson(await api.request('/day?day=1'))).toMatchObject({ streak: 0 });
    expect(await winCedar()).toMatchObject({ streak: 1 });
    expect(await kv.hGetAll(kv.dayStatsKey(1))).toEqual({ clears: '1', parClears: '1' });
  });

  it('stores only bounded integer profile fields', async () => {
    vi.setSystemTime(utcNoon(4));
    const res = await postRun({
      day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25,
      note: 'unmoderated text', username: 'untrusted name', streak: 99, rank: 77,
    });
    expect(await readJson(res)).toMatchObject({ won: true, streak: 1, rank: 1 });
    const profile = await kv.hGetAll(kv.userProfileKey('local'));
    expect(profile).toEqual({ streak: '1', lastClearUtcDay: '4', totalClears: '1', totalParClears: '1' });
    for (const value of Object.values(profile)) expect(value).toMatch(/^[0-9]+$/);
    expect(await kv.hGetAll(kv.userBestsKey('local'))).toMatchObject({ 'day:1': expect.stringMatching(/^2:[0-9]+$/) });
  });

  it('restores a legacy best to the leaderboard and seeds profile totals on a slower clear', async () => {
    vi.setSystemTime(utcNoon(4));
    const bests = kv.userBestsKey('local');
    const leaderboard = kv.dayLeaderboardKey(1);
    await kv.hSet(bests, { 'day:1': '2:1500', 'day:3': '4:2000' });
    await kv.hSet(kv.dayStatsKey(1), { clears: '1', parClears: '1' });

    const slower = await postRun({ day: 1, clackTicks: [10, 20, ...CEDAR_PAR], endTick: SIM_HZ * 25 });
    expect(await readJson(slower)).toMatchObject({
      won: true, clacks: 4, bestClacks: 2, isNewBest: false, rank: 1, totalPlayers: 1, streak: 1,
      completedDays: [1, 3], communityStats: { totalClears: 1, parClears: 1 },
    });
    expect(await kv.zScore(leaderboard, 'local')).toBe(2_001_500);
    expect(await kv.hGetAll(kv.userProfileKey('local'))).toEqual({
      streak: '1', lastClearUtcDay: '4', totalClears: '2', totalParClears: '1',
    });
  });

  it('ranks by composite score (clacks first, then finish tick) with Top X% percentile', async () => {
    const cedar = getIslandByDay(1);
    if (!cedar) throw new Error('missing cedar');
    const own = simulate(cedar, CEDAR_PAR, SIM_HZ * 25);
    const lb = kv.dayLeaderboardKey(1);
    await kv.zAdd(lb, 't2_faster', computeCompositeScore(2, own.finishTick - 1));
    await kv.zAdd(lb, 't2_moreclacks', computeCompositeScore(3, 1));
    await kv.zAdd(lb, 't2_slowest', computeCompositeScore(4, 1));

    expect(await winCedar()).toMatchObject({ rank: 2, percentile: 50, totalPlayers: 4 });
    expect(await kv.zScore(lb, 'local')).toBe(computeCompositeScore(2, own.finishTick));
    expect(await kv.zRank(lb, 't2_moreclacks')).toBe(2);
  });
});

describe('UTC daily scheduler and Mod Menu', () => {
  let postCounter = 0;
  beforeEach(() => {
    resetFallbackStore();
    devvit.context.clear();
    vi.resetAllMocks();
    postCounter = 0;
    devvit.reddit.submitCustomPost.mockImplementation(async () => {
      postCounter++;
      return { id: `t3_post${postCounter}` };
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 29, 0, 0, 5));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const fireScheduler = (): Promise<Response> =>
    Promise.resolve(scheduler.request('/daily-post', { method: 'POST', body: '{}' }));

  it('creates exactly one post per UTC day across sequential and concurrent triggers', async () => {
    const utcDay = getActiveUtcDay();
    const [first, ...burst] = await Promise.all([fireScheduler(), fireScheduler(), fireScheduler()]);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({});
    for (const res of burst) expect(res.status).toBe(200);
    expect((await fireScheduler()).status).toBe(200);

    expect(devvit.reddit.submitCustomPost).toHaveBeenCalledTimes(1);
    expect(await kv.get(kv.schedPostedKey(utcDay))).toBe('t3_post1');
    expect(await kv.hGetAll(kv.postMetaKey('t3_post1'))).toEqual({
      day: String(resolveCatalogueDay(utcDay)),
      createdUtcDay: String(utcDay),
    });

    vi.setSystemTime(Date.UTC(2026, 10, 30, 0, 0, 5));
    expect((await fireScheduler()).status).toBe(200);
    expect(devvit.reddit.submitCustomPost).toHaveBeenCalledTimes(2);
    expect(await kv.get(kv.schedPostedKey(utcDay + 1))).toBe('t3_post2');
  });

  it('repairs a failed Redis binding without publishing again', async () => {
    devvit.context.set('subredditId', 't5_test');
    const lockKey = kv.schedPostedKey(getActiveUtcDay());
    let lock: string | undefined;
    devvit.redis.set.mockImplementation(async (_key: string, value: string, options?: { nx: boolean }) => {
      if (options?.nx && lock !== undefined) return undefined;
      lock = value;
      return 'OK';
    });
    devvit.redis.get.mockImplementation(async () => lock);
    devvit.redis.hSet.mockRejectedValueOnce(new Error('Redis unavailable'));

    expect((await fireScheduler()).status).toBe(500);
    expect(lock).toBe('t3_post1');
    expect(devvit.redis.set).toHaveBeenCalledWith(lockKey, 'pending', { nx: true });
    expect(devvit.redis.del).not.toHaveBeenCalled();
    expect((await fireScheduler()).status).toBe(200);
    expect(devvit.reddit.submitCustomPost).toHaveBeenCalledTimes(1);
    expect(devvit.redis.hSet).toHaveBeenLastCalledWith(kv.postMetaKey('t3_post1'), {
      day: String(resolveCatalogueDay(getActiveUtcDay())),
      createdUtcDay: String(getActiveUtcDay()),
    });
  });

  it('retains the daily lock if saving an acknowledged Reddit post ID fails', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.redis.set
      .mockResolvedValueOnce('OK')
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce(undefined);
    devvit.redis.get.mockResolvedValue('pending');

    expect((await fireScheduler()).status).toBe(500);
    expect(devvit.redis.del).not.toHaveBeenCalled();
    expect((await fireScheduler()).status).toBe(200);
    expect(devvit.reddit.submitCustomPost).toHaveBeenCalledTimes(1);
  });

  it('releases the UTC day lock when post creation fails so a retry succeeds', async () => {
    devvit.reddit.submitCustomPost.mockRejectedValueOnce(new Error('reddit down'));
    expect((await fireScheduler()).status).toBe(500);
    expect(await kv.get(kv.schedPostedKey(getActiveUtcDay()))).toBeUndefined();
    expect((await fireScheduler()).status).toBe(200);
    expect(devvit.reddit.submitCustomPost).toHaveBeenCalledTimes(2);
    expect(await kv.get(kv.schedPostedKey(getActiveUtcDay()))).toBe('t3_post1');
  });

  it('seeds the UTC day lock on install so the scheduler never double-posts', async () => {
    const install = await triggers.request('/on-app-install', { method: 'POST', body: '{}' });
    expect(install.status).toBe(200);
    expect((await fireScheduler()).status).toBe(200);
    expect(devvit.reddit.submitCustomPost).toHaveBeenCalledTimes(1);
  });

  it('publishes the active day from post-create', async () => {
    const res = await menu.request('/post-create', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      navigateTo: 'https://reddit.com/r/clack_test/comments/t3_post1',
    });
  });

  it('presents a spawn-day select form listing every catalogue island', async () => {
    const res = await menu.request('/spawn-day', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body['showForm']).toMatchObject({
      name: 'spawnDayForm',
      form: {
        fields: [
          {
            type: 'select',
            name: 'day',
            required: true,
            options: [
              { label: 'Day 1 · Cedar Courtyard', value: '1' },
              expect.anything(), expect.anything(), expect.anything(), expect.anything(),
            ],
          },
        ],
      },
    });
  });

  it('registers the internal actions with Devvit and keeps QA artifacts private', () => {
    expect(config.scheduler.tasks['daily-post']).toEqual({
      endpoint: '/internal/scheduler/daily-post', cron: '0 0 * * *',
    });
    expect(config.forms).toMatchObject({ spawnDayForm: '/internal/menu/spawn-day-submit' });
    expect(config.triggers.onAppInstall).toBe('/internal/triggers/on-app-install');
    for (const endpoint of ['/internal/menu/post-create', '/internal/menu/spawn-day']) {
      expect(config.menu.items).toContainEqual(expect.objectContaining({
        endpoint, location: 'subreddit', forUserType: 'moderator',
      }));
    }
    expect(config.sourceIgnores).toEqual(expect.arrayContaining(['.internal/**', 'e2e/**']));
    expect(config.permissions).toMatchObject({ reddit: { enable: true }, redis: true });
  });

  it('returns a toast with no binding when Reddit denies a menu post', async () => {
    devvit.reddit.submitCustomPost.mockRejectedValueOnce(new Error('Permission denied'));
    const res = await menu.request('/spawn-day-submit', {
      method: 'POST',
      body: JSON.stringify({ values: { day: ['3'] } }),
    });
    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ showToast: 'Failed to create Clack post' });
    expect(await kv.hGetAll(kv.postMetaKey('t3_post1'))).toEqual({});
  });

  it('spawns and binds a chosen day, rejecting malformed or unknown days', async () => {
    const submit = (payload: unknown): Promise<Response> =>
      Promise.resolve(
        menu.request('/spawn-day-submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        })
      );
    for (const bad of [{}, { day: ['9'] }, { day: ['0'] }, { day: 'abc' }, { day: ['1', '2'] }, { day: [1.5] }, '{oops']) {
      const res = await submit(bad);
      expect(res.status).toBe(400);
      expect(await readJson(res)).toHaveProperty('showToast');
    }
    expect(devvit.reddit.submitCustomPost).not.toHaveBeenCalled();

    const ok = await submit({ day: ['3'] });
    expect(ok.status).toBe(200);
    expect(await readJson(ok)).toEqual({ navigateTo: 'https://reddit.com/r/clack_test/comments/t3_post1' });
    expect(await kv.hGet(kv.postMetaKey('t3_post1'), 'day')).toBe('3');
    expect((await submit({ day: 4 })).status).toBe(200);
    expect(await kv.hGet(kv.postMetaKey('t3_post2'), 'day')).toBe('4');
  });
});

describe('UTC day resolution', () => {
  it('cycles UTC days across the 5-island catalogue', () => {
    expect([1, 2, 5, 6, 10, 11].map(resolveCatalogueDay)).toEqual([1, 2, 5, 1, 5, 1]);
  });

  it('starts at Day 1 on the launch epoch and never goes below 1', () => {
    expect(getActiveUtcDay(Date.UTC(2026, 10, 27, 12))).toBe(1);
    expect(getActiveUtcDay(Date.UTC(2026, 10, 28))).toBe(2);
    expect(getActiveUtcDay(Date.UTC(2020, 0, 1))).toBe(1);
  });
});
