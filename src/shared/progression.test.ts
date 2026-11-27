import { describe, expect, it } from 'vitest';
import {
  isCommunityDayStats,
  isDayResponse,
  isRunSubmissionResponse,
  MAX_CLACK_EVENTS,
  MAX_REPLAY_TICKS,
  parseDayQuery,
  parseRunSubmissionRequest,
} from './api';
import type { DayResponse, RunSubmissionResponse } from './api';
import type { StreakState } from './progression';
import { ISLANDS } from './levels';
import {
  computeCompositeScore,
  computeTopPercent,
  decodeCompositeScore,
  encodeBestEntry,
  evaluateStreakOnClear,
  getEffectiveStreak,
  isBetterRun,
  parseBestEntry,
} from './progression';

const unsafe = Number.MAX_SAFE_INTEGER + 1;
const invalidIntegers = [-1, 0.5, NaN, Infinity, unsafe];

describe('replay request validation', () => {
  const replay = { day: 1, clackTicks: [300, 1120], endTick: 1 };

  it('accepts ticks beyond the replay end and drops unrelated claims', () => {
    expect(parseRunSubmissionRequest({ ...replay, won: true, clacks: 0 })).toEqual(replay);
  });

  it('accepts inclusive bounds and preserves an optional run count', () => {
    const atBounds = {
      day: Number.MAX_SAFE_INTEGER,
      clackTicks: Array.from({ length: MAX_CLACK_EVENTS }, (_, i) => i === 0 ? 0 : MAX_REPLAY_TICKS),
      endTick: MAX_REPLAY_TICKS,
      runCount: Number.MAX_SAFE_INTEGER,
    };
    expect(parseRunSubmissionRequest(atBounds)).toEqual(atBounds);
    expect(parseRunSubmissionRequest({ day: 1, clackTicks: [], endTick: 0 })).toEqual({
      day: 1, clackTicks: [], endTick: 0,
    });
  });

  it('rejects malformed envelopes, inherited fields, and prototype keys', () => {
    for (const body of [null, 'replay', [], {}, Object.assign([], replay), Object.create(replay)]) {
      expect(parseRunSubmissionRequest(body)).toBeNull();
    }
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(parseRunSubmissionRequest({ ...replay, [key]: {} })).toBeNull();
    }
  });

  it.each([0, ...invalidIntegers, '1', null, undefined])('rejects invalid day and run count %s', (value) => {
    expect(parseRunSubmissionRequest({ ...replay, day: value })).toBeNull();
    expect(parseRunSubmissionRequest({ ...replay, runCount: value })).toBeNull();
  });

  it.each([...invalidIntegers, MAX_REPLAY_TICKS + 1, '1', null, undefined])('rejects invalid tick %s', (value) => {
    expect(parseRunSubmissionRequest({ ...replay, endTick: value })).toBeNull();
    expect(parseRunSubmissionRequest({ ...replay, clackTicks: [0, value] })).toBeNull();
  });

  it('rejects non-array, oversize, and sparse tick lists', () => {
    for (const clackTicks of [null, '1', { 0: 1, length: 1 }, Array(1), Array(MAX_CLACK_EVENTS + 1).fill(0)]) {
      expect(parseRunSubmissionRequest({ ...replay, clackTicks })).toBeNull();
    }
  });
});

describe('day query parsing', () => {
  it('accepts positive decimal safe integers', () => {
    expect(parseDayQuery('1')).toBe(1);
    expect(parseDayQuery(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([undefined, '', '0', '01', '-1', '+1', '1.0', '1e1', '1x', ' 1', '1\n', String(unsafe)])(
    'rejects invalid day %j', (raw) => expect(parseDayQuery(raw)).toBeNull()
  );
});

describe('progression fields in API responses', () => {
  const communityStats = { totalClears: 0, parClears: 0, parRatePercent: null };
  const level = ISLANDS[0];
  if (!level) throw new Error('Expected an island for response fixtures');
  const day: DayResponse = {
    day: 1, level, allDays: [], completedDays: [], bestClacksByDay: {}, userBestClacks: null,
    userCleared: false, communityStats, streak: 0, userRank: null, totalPlayers: 0,
  };
  const run: RunSubmissionResponse = {
    verified: true, day: 1, islandId: level.id, won: false, phase: 'rolling', clacks: 0,
    par: 2, finishTick: 0, hash: '0', bestClacks: null, isNewBest: false, completedDays: [],
    communityStats, streak: 0, rank: null, percentile: null, totalPlayers: 0,
  };

  it('accepts ranked and unranked responses', () => {
    expect(isDayResponse(day)).toBe(true);
    expect(isDayResponse({ ...day, streak: 3, userRank: 1, totalPlayers: 1 })).toBe(true);
    expect(isRunSubmissionResponse(run)).toBe(true);
    expect(isRunSubmissionResponse({ ...run, streak: 1, rank: 1, percentile: 100, totalPlayers: 1 })).toBe(true);
    expect(isRunSubmissionResponse({ ...run, rank: 1, percentile: 1, totalPlayers: 100 })).toBe(true);
  });

  it.each([...invalidIntegers, '1', undefined])('rejects invalid progression field %s', (value) => {
    for (const field of ['streak', 'totalPlayers']) {
      expect(isDayResponse({ ...day, [field]: value })).toBe(false);
      expect(isRunSubmissionResponse({ ...run, [field]: value })).toBe(false);
    }
    expect(isDayResponse({ ...day, userRank: value })).toBe(false);
    expect(isRunSubmissionResponse({ ...run, rank: value })).toBe(false);
    expect(isRunSubmissionResponse({ ...run, percentile: value })).toBe(false);
  });

  it('rejects zero ranks and percentiles outside 1 through 100', () => {
    expect(isDayResponse({ ...day, userRank: 0 })).toBe(false);
    expect(isRunSubmissionResponse({ ...run, rank: 0 })).toBe(false);
    expect(isRunSubmissionResponse({ ...run, percentile: 0 })).toBe(false);
    expect(isRunSubmissionResponse({ ...run, percentile: 101 })).toBe(false);
  });
});

describe('UTC streaks', () => {
  const empty = { streak: 0, lastClearUtcDay: null };
  const previous = { streak: 3, lastClearUtcDay: 10 };

  it('starts on the first UTC day and after invalid stored state', () => {
    expect(evaluateStreakOnClear(empty, 1)).toEqual({ streak: 1, lastClearUtcDay: 1 });
    expect(evaluateStreakOnClear({ streak: 0, lastClearUtcDay: 10 }, 11)).toEqual({ streak: 1, lastClearUtcDay: 11 });
    expect(evaluateStreakOnClear({ streak: 3, lastClearUtcDay: null }, 11)).toEqual({ streak: 1, lastClearUtcDay: 11 });
  });

  it('keeps same-day and out-of-order clears idempotent', () => {
    expect(evaluateStreakOnClear(previous, 10)).toEqual(previous);
    expect(evaluateStreakOnClear(previous, 9)).toEqual(previous);
  });

  it('advances consecutive clears and resets after a missed day', () => {
    expect(evaluateStreakOnClear(previous, 11)).toEqual({ streak: 4, lastClearUtcDay: 11 });
    expect(evaluateStreakOnClear(previous, 12)).toEqual({ streak: 1, lastClearUtcDay: 12 });
  });

  it('never grows past the safe integer ceiling', () => {
    expect(evaluateStreakOnClear({ ...previous, streak: Number.MAX_SAFE_INTEGER }, 11)).toEqual({
      streak: Number.MAX_SAFE_INTEGER, lastClearUtcDay: 11,
    });
  });

  it.each([0, ...invalidIntegers])('rejects invalid UTC day or streak component %s', (value) => {
    expect(evaluateStreakOnClear(previous, value)).toEqual(previous);
    expect(evaluateStreakOnClear({ ...previous, streak: value }, value)).toEqual(empty);
    expect(getEffectiveStreak(previous, value)).toBe(0);
    expect(getEffectiveStreak({ ...previous, streak: value }, 10)).toBe(0);
    expect(getEffectiveStreak({ ...previous, lastClearUtcDay: value }, 10)).toBe(0);
  });

  it('counts the last clear day and the following day only', () => {
    expect(getEffectiveStreak(previous, 9)).toBe(0);
    expect(getEffectiveStreak(previous, 10)).toBe(3);
    expect(getEffectiveStreak(previous, 11)).toBe(3);
    expect(getEffectiveStreak(previous, 12)).toBe(0);
    expect(getEffectiveStreak(empty, 1)).toBe(0);
  });
});

describe('leaderboard scores and best entries', () => {
  it('packs and decodes bounded runs, including zero and the safe integer ceiling', () => {
    expect(computeCompositeScore(256, 7200)).toBe(256_007_200);
    expect(decodeCompositeScore(256_007_200)).toEqual({ clacks: 256, finishTick: 7200 });
    expect(computeCompositeScore(-0, -0)).toBe(0);
    expect(decodeCompositeScore(-0)).toEqual({ clacks: 0, finishTick: 0 });
    expect(computeCompositeScore(9007199254, 740991)).toBe(Number.MAX_SAFE_INTEGER);
    expect(decodeCompositeScore(Number.MAX_SAFE_INTEGER)).toEqual({ clacks: 9007199254, finishTick: 740991 });
    expect(() => computeCompositeScore(9007199254, 740992)).toThrow(RangeError);
  });

  it('orders by clacks first, then finish tick, with a capped tick component', () => {
    const best = { clacks: 2, finishTick: 300 };
    expect(computeCompositeScore(1, 1_000_001)).toBe(1_999_999);
    expect(isBetterRun(null, best)).toBe(true);
    expect(isBetterRun(best, { clacks: 1, finishTick: 1_000_000 })).toBe(true);
    expect(isBetterRun(best, { clacks: 2, finishTick: 299 })).toBe(true);
    expect(isBetterRun(best, best)).toBe(false);
    expect(isBetterRun(best, { clacks: 2, finishTick: 301 })).toBe(false);
    expect(isBetterRun(best, { clacks: 3, finishTick: 0 })).toBe(false);
  });

  it.each(invalidIntegers)('rejects invalid score or entry components %s', (value) => {
    expect(() => computeCompositeScore(value, 0)).toThrow(RangeError);
    expect(() => computeCompositeScore(0, value)).toThrow(RangeError);
    expect(decodeCompositeScore(value)).toBeNull();
    expect(() => encodeBestEntry(value, 0)).toThrow(RangeError);
    expect(() => encodeBestEntry(0, value)).toThrow(RangeError);
    expect(parseBestEntry(`${value}:0`)).toBeNull();
    expect(parseBestEntry(`0:${value}`)).toBeNull();
  });

  it('uses a strict decimal storage codec without applying the score tick cap', () => {
    expect(encodeBestEntry(2, 1_000_000)).toBe('2:1000000');
    expect(parseBestEntry(encodeBestEntry(2, 1_000_000))).toEqual({ clacks: 2, finishTick: 1_000_000 });
    expect(parseBestEntry('0:0')).toEqual({ clacks: 0, finishTick: 0 });
    for (const raw of [undefined, '', '1:', ':1', '1:2:3', '1:2\n', ' 1:2', '1:2x', '+1:2']) {
      expect(parseBestEntry(raw)).toBeNull();
    }
  });
});

describe('leaderboard top percent', () => {
  it('rounds up to the next whole percent while preserving exact boundaries', () => {
    expect(computeTopPercent(0, 100)).toBe(1);
    expect(computeTopPercent(0, 1000)).toBe(1);
    expect(computeTopPercent(6, 100)).toBe(7);
    expect(computeTopPercent(9, 84)).toBe(12);
    expect(computeTopPercent(83, 84)).toBe(100);
  });

  it.each([[-1, 1], [0.5, 1], [NaN, 1], [Infinity, 1], [0, 0], [0, -1],
    [0, 1.5], [0, NaN], [0, Infinity], [1, 1]])('rejects rank %s of %s', (rank, total) => {
    expect(computeTopPercent(rank, total)).toBeNull();
  });
});

describe('QA edge cases', () => {
  it('canonicalizes JSON -0 ticks and rejects JSON prototype keys', () => {
    const parsed = parseRunSubmissionRequest(JSON.parse('{"day":1,"clackTicks":[-0,5],"endTick":-0}'));
    expect(parsed).toEqual({ day: 1, clackTicks: [0, 5], endTick: 0 });
    expect(Object.is(parsed?.clackTicks[0], 0)).toBe(true);
    expect(Object.is(parsed?.endTick, 0)).toBe(true);
    expect(parseRunSubmissionRequest(JSON.parse('{"day":-0,"clackTicks":[],"endTick":0}'))).toBeNull();
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const raw = `{"day":1,"clackTicks":[],"endTick":0,"${key}":{"won":true}}`;
      expect(parseRunSubmissionRequest(JSON.parse(raw))).toBeNull();
    }
  });

  it('accepts exactly MAX_CLACK_EVENTS ticks and rejects one more', () => {
    const ticks = Array.from({ length: MAX_CLACK_EVENTS }, (_, i) => i);
    expect(parseRunSubmissionRequest({ day: 1, clackTicks: ticks, endTick: 0 })).not.toBeNull();
    expect(parseRunSubmissionRequest({ day: 1, clackTicks: [...ticks, 0], endTick: 0 })).toBeNull();
  });

  it('validates community par rate as an integer percent', () => {
    const base = { totalClears: 4, parClears: 1 };
    for (const rate of [null, 0, 25, 100]) {
      expect(isCommunityDayStats({ ...base, parRatePercent: rate })).toBe(true);
    }
    for (const rate of [-1, 101, 2.5, NaN, Infinity, '25', undefined]) {
      expect(isCommunityDayStats({ ...base, parRatePercent: rate })).toBe(false);
    }
  });

  it('walks a UTC streak from launch day through gaps and late submissions', () => {
    let state: StreakState = { streak: 0, lastClearUtcDay: null };
    const timeline: Array<[number, number, number]> = [
      // [utcDay, expected stored streak, expected effective streak next day]
      [1, 1, 1], [1, 1, 1], [2, 2, 2], [3, 3, 3], [2, 3, 3], [5, 1, 1], [6, 2, 2], [6, 2, 2],
    ];
    for (const [utcDay, stored, nextDay] of timeline) {
      state = evaluateStreakOnClear(state, utcDay);
      expect(state.streak).toBe(stored);
      const last = state.lastClearUtcDay ?? 0;
      expect(getEffectiveStreak(state, last)).toBe(stored);
      expect(getEffectiveStreak(state, last + 1)).toBe(nextDay);
      expect(getEffectiveStreak(state, last + 2)).toBe(0);
    }
  });

  it('keeps composite scores strictly lexicographic and losslessly decodable for every valid run', () => {
    const ticks = [0, 1, 2, 299, 300, 3599, 7199, MAX_REPLAY_TICKS];
    let previous = -1;
    for (let clacks = 0; clacks <= MAX_CLACK_EVENTS; clacks++) {
      for (const finishTick of ticks) {
        const score = computeCompositeScore(clacks, finishTick);
        expect(score).toBeGreaterThan(previous);
        expect(Number.isSafeInteger(score)).toBe(true);
        expect(decodeCompositeScore(score)).toEqual({ clacks, finishTick });
        expect(parseBestEntry(encodeBestEntry(clacks, finishTick))).toEqual({ clacks, finishTick });
        previous = score;
      }
    }
    expect(previous).toBeLessThan(2.6e8);
  });

  it('matches exact integer ceil for Top X% and never decreases with rank', () => {
    for (let total = 1; total <= 400; total++) {
      let last = 0;
      for (let rank = 0; rank < total; rank++) {
        const pct = computeTopPercent(rank, total);
        const exact = Math.floor(((rank + 1) * 100 + total - 1) / total);
        expect(pct).toBe(exact);
        expect(pct).toBeGreaterThanOrEqual(Math.max(1, last));
        expect(pct).toBeLessThanOrEqual(100);
        last = exact;
      }
      expect(computeTopPercent(total - 1, total)).toBe(100);
    }
  });
});
