import { describe, expect, it } from 'vitest';
import { CORE_ISLANDS, getIslandByDay, getIslandById, ISLANDS } from '../levels';
import { BASE_SPEED_SIM_PER_SEC, BOOST_DURATION_TICKS, BOOST_SPEED_SIM_PER_SEC, createInitialState, hashSimState, launchSim, SIM_HZ, simulate, step } from './engine';
import type { SimEvent, SimState } from './types';

const PAR_SOLUTIONS: Readonly<Record<string, readonly number[]>> = {
  cedar: [300, 1120],
  mossy: [350, 1040, 1450],
  amber: [220, 840, 1050],
  frosty: [220, 440, 635, 860],
  dusk: [220, 600, 840, 1090],
};

describe('Clack 120 Hz deterministic simulation', () => {
  it('validates graph integrity and integer lengths across all 5 islands', () => {
    expect(ISLANDS).toHaveLength(5);

    for (const island of ISLANDS) {
      expect(island.totalKeys).toBe(3);
      expect(island.nodes['start']?.type).toBe('start');
      expect(island.nodes['bell']?.type).toBe('bell');

      for (const edge of island.edges) {
        expect(Number.isInteger(edge.lengthSim)).toBe(true);
        expect(edge.lengthSim).toBeGreaterThan(0);
        expect(island.nodes[edge.from]).toBeDefined();
        expect(island.nodes[edge.to]).toBeDefined();
        for (const item of edge.items) {
          expect(Number.isInteger(item.simPos)).toBe(true);
          expect(Number.isInteger(item.triggerRadiusSim)).toBe(true);
          expect(item.simPos).toBeGreaterThan(0);
          expect(item.simPos).toBeLessThan(edge.lengthSim);
        }
      }
    }
  });

  for (const island of ISLANDS) {
    it(`solves Day ${island.day} (${island.name}) at exact Par ${island.par}`, () => {
      const clackTicks = PAR_SOLUTIONS[island.id] ?? [];
      expect(clackTicks).toHaveLength(island.par);

      const endTick = SIM_HZ * 25;
      const result = simulate(island, clackTicks, endTick);

      expect(result.won).toBe(true);
      expect(result.state.phase).toBe('won');
      expect(result.clacks).toBe(island.par);
      expect(result.state.keysCollected).toBe(island.totalKeys);
      expect(result.finishTick).toBeGreaterThan(0);
      expect(result.finishTick).toBeLessThan(endTick);
      expect(result.events.some((ev) => ev.type === 'win')).toBe(true);
    });

    it(`produces identical hashes across repeated replays on Day ${island.day} (${island.name})`, () => {
      const clackTicks = PAR_SOLUTIONS[island.id] ?? [];
      const endTick = SIM_HZ * 25;

      const first = simulate(island, clackTicks, endTick);
      const second = simulate(island, clackTicks, endTick);
      const third = simulate(island, clackTicks, endTick);

      expect(first.hash).toBe(second.hash);
      expect(second.hash).toBe(third.hash);
      expect(first.finishTick).toBe(second.finishTick);
      expect(first.events).toEqual(second.events);

      // Verify tick-by-tick step() matches simulate() 1:1
      const clackSet = new Set(clackTicks);
      let { state, events } = launchSim(createInitialState(island));
      for (let t = 0; t < endTick; t++) {
        if (state.phase === 'won' || state.phase === 'falling' || state.phase === 'locked') {
          break;
        }
        const next = step(island, state, clackSet.has(t));
        state = next.state;
        events = [...events, ...next.events];
      }

      expect(state).toEqual(first.state);
      expect(events).toEqual(first.events);
      expect(state.clacks).toBe(first.clacks);
      expect(state.tick).toBe(first.finishTick);
      expect(hashSimState(island, state)).toBe(first.hash);
    });
  }

  it('triggers trapdoor failure when routed into a trapdoor', () => {
    const frosty = getIslandById('frosty');
    expect(frosty).toBeDefined();
    if (!frosty) return;

    // Clack immediately at tick 10 so g1 routes to branch B -> trap1
    const result = simulate(frosty, [10], SIM_HZ * 10);
    expect(result.won).toBe(false);
    expect(result.state.phase).toBe('falling');
    expect(result.events.some((ev) => ev.type === 'trapdoor')).toBe(true);
  });

  it('locks the bell if reached before collecting all 3 keys', () => {
    const cedar = getIslandById('cedar');
    expect(cedar).toBeDefined();
    if (!cedar) return;

    // Clack before first gate (skip Key 0), then clack before g3 to enter bell with only 2 keys
    const result = simulate(cedar, [10, 620], SIM_HZ * 15);
    expect(result.won).toBe(false);
    expect(result.state.phase).toBe('locked');
    expect(result.state.keysCollected).toBe(2);
    expect(result.events.some((ev) => ev.type === 'locked')).toBe(true);
  });

  it('activates spring speed boost and respects cooldown', () => {
    const cedar = getIslandById('cedar');
    expect(cedar).toBeDefined();
    if (!cedar) return;

    const result = simulate(cedar, PAR_SOLUTIONS['cedar'] ?? [], SIM_HZ * 25);
    const springEvents = result.events.filter((ev) => ev.type === 'spring');
    expect(springEvents).toHaveLength(1);
  });

  it('registers the 5 core islands as Days 1-5 in the daily category', () => {
    expect(CORE_ISLANDS.map((island) => island.id)).toEqual([
      'cedar',
      'mossy',
      'amber',
      'frosty',
      'dusk',
    ]);
    for (const [idx, island] of CORE_ISLANDS.entries()) {
      expect(island.category).toBe('daily');
      expect(island.day).toBe(idx + 1);
      expect(getIslandByDay(idx + 1)).toBe(island);
    }
    expect(getIslandByDay(0)).toBeUndefined();
    expect(getIslandById('nope')).toBeUndefined();
  });

  it('initializes every extensible twist register deterministically', () => {
    for (const island of ISLANDS) {
      const state = createInitialState(island);
      expect(state.edgeDirection).toBe(1);
      expect(state.jammedGateMask).toBe(0);
      expect(state.scaleMask).toBe(0);
      expect(state.portalHoldTicks).toBe(0);
      expect(state.portalTargetNodeId).toBeNull();
      expect(state.jumpArcTicksRemaining).toBe(0);
      expect(state.jumpTargetEdgeId).toBeNull();
      expect(state.jumpTargetSimPos).toBe(0);
      expect(state.itemCooldownTick).toEqual({});
    }
  });

  it('folds twist registers and item cooldowns into the state hash', () => {
    const cedar = getIslandById('cedar');
    if (!cedar) throw new Error('cedar missing');
    const base = createInitialState(cedar);
    const baseHash = hashSimState(cedar, base);
    const variants: SimState[] = [
      { ...base, edgeDirection: -1 },
      { ...base, jammedGateMask: 1 },
      { ...base, scaleMask: 2 },
      { ...base, portalHoldTicks: 24 },
      { ...base, portalTargetNodeId: 'p2' },
      { ...base, jumpArcTicksRemaining: 3 },
      { ...base, jumpTargetEdgeId: 'e1' },
      { ...base, jumpTargetSimPos: 500 },
      { ...base, itemCooldownTick: { s1: 10 } },
    ];
    for (const v of variants) {
      expect(hashSimState(cedar, v)).not.toBe(baseHash);
    }
    // Cooldown key order never affects the hash
    expect(hashSimState(cedar, { ...base, itemCooldownTick: { a: 1, b: 2 } })).toBe(
      hashSimState(cedar, { ...base, itemCooldownTick: { b: 2, a: 1 } })
    );
  });

  it('records spring cooldowns in itemCooldownTick on the Par run', () => {
    const cedar = getIslandById('cedar');
    if (!cedar) throw new Error('cedar missing');
    const result = simulate(cedar, PAR_SOLUTIONS['cedar'] ?? [], SIM_HZ * 25);
    const spring = result.events.find(
      (ev): ev is Extract<SimEvent, { type: 'spring' }> => ev.type === 'spring'
    );
    expect(spring).toBeDefined();
    if (!spring) return;
    expect(result.state.itemCooldownTick[spring.springId]).toBe(spring.tick);
  });

  it('preserves exact Bresenham distance through the base-to-boost transition', () => {
    const cedar = getIslandById('cedar');
    if (!cedar) throw new Error('cedar missing');
    let { state } = launchSim(createInitialState(cedar));
    let numerator = 0;
    let distance = 0;
    let boostTicks = 0;
    const clacks = new Set(PAR_SOLUTIONS['cedar']);
    while (state.phase === 'rolling' && state.tick < SIM_HZ * 25) {
      if (state.boostTicks > 0) boostTicks++;
      const remainingBoost = Math.max(0, state.boostTicks - 1);
      const boostSpeed = (BOOST_SPEED_SIM_PER_SEC - BASE_SPEED_SIM_PER_SEC) * remainingBoost;
      numerator += BASE_SPEED_SIM_PER_SEC + Math.floor(boostSpeed / BOOST_DURATION_TICKS);
      state = step(cedar, state, clacks.has(state.tick)).state;
      distance += state.lastStepSim;
      expect(distance).toBe(Math.floor(numerator / SIM_HZ));
      expect(state.speedRemainder).toBe(numerator % SIM_HZ);
    }
    expect(boostTicks).toBeGreaterThan(0);
    expect(state.phase).toBe('won');
  });

  it('ends on the precise finish boundary and discards invalid and terminal inputs', () => {
    const cedar = getIslandById('cedar');
    if (!cedar) throw new Error('cedar missing');
    const schedule = PAR_SOLUTIONS['cedar'] ?? [];
    const baseline = simulate(cedar, schedule, SIM_HZ * 25);
    const { finishTick } = baseline;
    expect(simulate(cedar, schedule, finishTick - 1).won).toBe(false);
    expect(simulate(cedar, [...schedule, finishTick, NaN, Infinity], finishTick + 10))
      .toEqual(baseline);
    expect(simulate(cedar, schedule, finishTick)).toEqual(baseline);
  });

  it('ignores out-of-range, duplicate, and unsorted clack ticks identically', () => {
    const cedar = getIslandById('cedar');
    if (!cedar) throw new Error('cedar missing');
    const clean = simulate(cedar, [300, 1120], SIM_HZ * 25);
    const noisy = simulate(cedar, [1120, 300, 300, 99999, -5], SIM_HZ * 25);
    expect(noisy.hash).toBe(clean.hash);
    expect(noisy.won).toBe(true);
  });
});
