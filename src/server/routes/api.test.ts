import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CLACK_EVENTS, MAX_REPLAY_TICKS } from '../../shared/api';
import { SIM_HZ } from '../../shared/sim';
import { getActiveUtcDay, resolveCatalogueDay } from '../core/post';
import { api, resetFallbackStore } from './api';

const devvit = vi.hoisted(() => ({
  context: new Map<string, string>(),
  redis: {
    hGet: vi.fn<(key: string, field: string) => Promise<string | undefined>>(),
    hGetAll: vi.fn<(key: string) => Promise<Record<string, string>>>(),
    watch: vi.fn(),
  },
}));
vi.mock('@devvit/web/server', () => ({
  redis: devvit.redis,
  context: {
    get subredditId() { return devvit.context.get('subredditId'); },
    get userId() { return devvit.context.get('userId'); },
    get postId() { return devvit.context.get('postId'); },
  },
}));

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
    const tx = {
      multi: vi.fn(),
      hSet: vi.fn(),
      hIncrBy: vi.fn(),
      exec: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([0, 1]),
    };
    devvit.redis.watch.mockResolvedValue(tx);
    devvit.redis.hGet
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('4:1500');
    devvit.redis.hGetAll.mockImplementation(async (key): Promise<Record<string, string>> =>
      key === 'clack:v2:stats:day:1' ? { clears: '1', parClears: '1' } : { 'day:1': '2:1500' }
    );

    const response = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(response.status).toBe(200);
    expect(devvit.redis.watch).toHaveBeenCalledTimes(2);
    expect(tx.hIncrBy.mock.calls).toEqual([
      ['clack:v2:stats:day:1', 'clears', 1],
      ['clack:v2:stats:day:1', 'parClears', 1],
      ['clack:v2:stats:day:1', 'parClears', 1],
    ]);
    expect(await readJson(response)).toMatchObject({
      bestClacks: 2,
      isNewBest: true,
      communityStats: { totalClears: 1, parClears: 1, parRatePercent: 100 },
    });
  });

  it('returns a retryable status if Redis rejects every conditional commit', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.context.set('userId', 't2_test');
    const exec = vi.fn().mockResolvedValue([]);
    devvit.redis.watch.mockResolvedValue({ multi: vi.fn(), hSet: vi.fn(), hIncrBy: vi.fn(), exec });
    const response = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(response.status).toBe(503);
    expect(exec).toHaveBeenCalledTimes(5);
    expect(devvit.redis.hGetAll).not.toHaveBeenCalled();
  });

  it('verifies anonymous runs without recording bests or community clears', async () => {
    devvit.context.set('subredditId', 't5_test');
    devvit.redis.hGetAll.mockResolvedValue({});
    const response = await postRun({ day: 1, clackTicks: CEDAR_PAR, endTick: SIM_HZ * 25 });
    expect(await readJson(response)).toMatchObject({
      won: true, bestClacks: null, completedDays: [], isNewBest: false,
      communityStats: { totalClears: 0, parClears: 0, parRatePercent: null },
    });
    expect(devvit.redis.watch).not.toHaveBeenCalled();
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

  it('rejects oversized bodies before decoding JSON', async () => {
    const response = await postRun(' '.repeat(17 * 1024));
    expect(response.status).toBe(413);
  });

  it('rejects malformed payloads with HTTP 400 on POST /run', async () => {
    const bad: unknown[] = [
      '{not json',
      '{"day":1,"clackTicks":[1e999],"endTick":10}',
      '{"day":1,"clackTicks":[],"endTick":1e999}',
      { day: 'bad', clackTicks: [], endTick: 10 },
      { day: 1.5, clackTicks: [], endTick: 10 },
      { day: 1, clackTicks: 'x', endTick: 10 },
      { day: 1, clackTicks: [-1], endTick: 10 },
      { day: 1, clackTicks: [1.5], endTick: 10 },
      { day: 1, clackTicks: [null], endTick: 10 },
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

  it('returns 404 for unknown days on POST /run', async () => {
    const res = await postRun({ day: 99, clackTicks: [], endTick: 10 });
    expect(res.status).toBe(404);
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
