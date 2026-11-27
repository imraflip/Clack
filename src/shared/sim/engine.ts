import type { GateState, LevelDef, LevelEdge } from '../levels';
import type { SimEvent, SimResult, SimState, StepOutput } from './types';

export const SIM_HZ = 120;
export const SIM_UNITS_PER_WORLD = 1000;
export const BASE_SPEED_SIM_PER_SEC = 2380;
export const BOOST_SPEED_SIM_PER_SEC = 3720;
export const BOOST_DURATION_TICKS = 162; // 1.35s * 120 Hz
export const SPRING_COOLDOWN_TICKS = 96; // 0.8s * 120 Hz
export const RESET_DELAY_TICKS = 120; // 1.0s * 120 Hz

const MAX_TRANSITIONS_PER_TICK = 8;

type LevelIndex = {
  readonly edgeById: ReadonlyMap<string, LevelEdge>;
  readonly outgoingByNode: ReadonlyMap<string, readonly LevelEdge[]>;
  readonly startEdgeId: string;
};

function buildLevelIndex(level: LevelDef): LevelIndex {
  const edgeById = new Map<string, LevelEdge>();
  const outgoingMutable = new Map<string, LevelEdge[]>();

  for (const edge of level.edges) {
    edgeById.set(edge.id, edge);
    const list = outgoingMutable.get(edge.from);
    if (list) {
      list.push(edge);
    } else {
      outgoingMutable.set(edge.from, [edge]);
    }
  }

  const startEdges = outgoingMutable.get('start');
  const firstStartEdge = startEdges?.[0];
  if (!firstStartEdge) {
    throw new Error(`Level "${level.id}" has no outgoing edge from "start"`);
  }

  return {
    edgeById,
    outgoingByNode: outgoingMutable,
    startEdgeId: firstStartEdge.id,
  };
}

const levelIndexCache = new WeakMap<LevelDef, LevelIndex>();

function getLevelIndex(level: LevelDef): LevelIndex {
  const cached = levelIndexCache.get(level);
  if (cached) return cached;
  const built = buildLevelIndex(level);
  levelIndexCache.set(level, built);
  return built;
}

export function createInitialState(level: LevelDef): SimState {
  const index = getLevelIndex(level);
  return {
    tick: 0,
    phase: 'ready',
    gateState: level.startState,
    clacks: 0,
    clackTicks: [],
    keysMask: 0,
    keysCollected: 0,
    currentEdgeId: index.startEdgeId,
    edgeDistSim: 0,
    lastStepSim: 0,
    speedPerSecSim: BASE_SPEED_SIM_PER_SEC,
    speedRemainder: 0,
    boostTicks: 0,
    stateTimerTicks: 0,
    edgeDirection: 1,
    jammedGateMask: 0,
    scaleMask: 0,
    portalHoldTicks: 0,
    portalTargetNodeId: null,
    jumpArcTicksRemaining: 0,
    jumpTargetEdgeId: null,
    jumpTargetSimPos: 0,
    itemCooldownTick: {},
  };
}

export function launchSim(state: SimState): StepOutput {
  if (state.phase !== 'ready') {
    return { state, events: [] };
  }
  const nextState: SimState = {
    ...state,
    phase: 'rolling',
  };
  return {
    state: nextState,
    events: [{ type: 'launch', tick: state.tick }],
  };
}

function flipGateState(gateState: GateState): GateState {
  return gateState === 'A' ? 'B' : 'A';
}

function stepIndexed(
  level: LevelDef,
  index: LevelIndex,
  state: SimState,
  clackThisTick: boolean
): StepOutput {
  const events: SimEvent[] = [];

  if (state.phase === 'ready' || state.phase === 'won') {
    return { state, events };
  }

  const nextTick = state.tick + 1;

  if (state.phase === 'falling' || state.phase === 'locked') {
    const nextTimer = state.stateTimerTicks > 0 ? state.stateTimerTicks - 1 : 0;
    if (nextTimer === 0 && state.stateTimerTicks > 0) {
      events.push({ type: 'auto-reset-ready', tick: nextTick });
    }
    return {
      state: {
        ...state,
        tick: nextTick,
        lastStepSim: 0,
        stateTimerTicks: nextTimer,
      },
      events,
    };
  }

  // Rolling phase
  let gateState: GateState = state.gateState;
  let clacks = state.clacks;
  let clackTicks = state.clackTicks;

  if (clackThisTick) {
    gateState = flipGateState(gateState);
    clacks += 1;
    clackTicks = [...clackTicks, state.tick];
    events.push({ type: 'clack', tick: state.tick, toState: gateState });
  }

  // Integer speed computation with exact Bresenham remainder over SIM_HZ
  let boostTicks = state.boostTicks;
  let speedPerSecSim = BASE_SPEED_SIM_PER_SEC;
  if (boostTicks > 0) {
    boostTicks -= 1;
    const boostDelta = BOOST_SPEED_SIM_PER_SEC - BASE_SPEED_SIM_PER_SEC;
    speedPerSecSim =
      BASE_SPEED_SIM_PER_SEC + Math.trunc((boostDelta * boostTicks) / BOOST_DURATION_TICKS);
  }

  const numerator = speedPerSecSim + state.speedRemainder;
  const stepSim = Math.trunc(numerator / SIM_HZ);
  const speedRemainder = numerator % SIM_HZ;

  let phase: SimState['phase'] = state.phase;
  let currentEdgeId = state.currentEdgeId;
  let edgeDistSim = state.edgeDistSim + stepSim;
  const prevDistSim = state.edgeDistSim;
  let keysMask = state.keysMask;
  let keysCollected = state.keysCollected;
  let stateTimerTicks = state.stateTimerTicks;
  let itemCooldownTick: Record<string, number> | null = null;

  const getItemLastTick = (itemId: string): number => {
    if (itemCooldownTick && itemId in itemCooldownTick) {
      return itemCooldownTick[itemId] ?? -SPRING_COOLDOWN_TICKS - 1;
    }
    return state.itemCooldownTick[itemId] ?? -SPRING_COOLDOWN_TICKS - 1;
  };

  const setItemLastTick = (itemId: string, t: number): void => {
    if (!itemCooldownTick) {
      itemCooldownTick = { ...state.itemCooldownTick };
    }
    itemCooldownTick[itemId] = t;
  };

  const checkEdgeItems = (edge: LevelEdge, fromDist: number, toDist: number): void => {
    for (const item of edge.items) {
      const distDiff = toDist >= item.simPos ? toDist - item.simPos : item.simPos - toDist;
      const crossed = fromDist < item.simPos && toDist >= item.simPos;
      const inRange = distDiff <= item.triggerRadiusSim || crossed;
      if (!inRange) continue;

      switch (item.type) {
        case 'key': {
          const bit = 1 << item.keyId;
          if ((keysMask & bit) === 0) {
            keysMask |= bit;
            keysCollected += 1;
            events.push({
              type: 'key',
              tick: nextTick,
              keyId: item.keyId,
              edgeId: edge.id,
              keysCollected,
            });
          }
          break;
        }
        case 'spring': {
          const lastTick = getItemLastTick(item.springId);
          if (nextTick - lastTick > SPRING_COOLDOWN_TICKS) {
            setItemLastTick(item.springId, nextTick);
            boostTicks = BOOST_DURATION_TICKS;
            events.push({
              type: 'spring',
              tick: nextTick,
              springId: item.springId,
              edgeId: edge.id,
            });
          }
          break;
        }
        case 'bumper':
        case 'jump-ramp':
          // Twist items are inert in the core catalogue; their integer
          // behaviour lands with the twist islands that place them.
          break;
      }
    }
  };

  const activeEdge = index.edgeById.get(currentEdgeId);
  if (!activeEdge) {
    throw new Error(`Unknown edge "${currentEdgeId}" in level "${level.id}"`);
  }

  checkEdgeItems(activeEdge, prevDistSim, Math.min(edgeDistSim, activeEdge.lengthSim));

  let transitions = 0;
  let edgeObj: LevelEdge = activeEdge;
  while (
    phase === 'rolling' &&
    edgeDistSim >= edgeObj.lengthSim &&
    transitions < MAX_TRANSITIONS_PER_TICK
  ) {
    transitions += 1;
    const overflow = edgeDistSim - edgeObj.lengthSim;
    const nextNodeId = edgeObj.to;
    const nextNode = level.nodes[nextNodeId];
    if (!nextNode) {
      throw new Error(`Unknown node "${nextNodeId}" in level "${level.id}"`);
    }

    if (nextNode.type === 'trapdoor') {
      phase = 'falling';
      edgeDistSim = edgeObj.lengthSim;
      stateTimerTicks = RESET_DELAY_TICKS;
      events.push({ type: 'trapdoor', tick: nextTick, nodeId: nextNodeId });
      break;
    }

    if (nextNode.type === 'bell') {
      edgeDistSim = edgeObj.lengthSim;
      if (keysCollected >= level.totalKeys) {
        phase = 'won';
        events.push({ type: 'win', tick: nextTick, clacks, par: level.par });
      } else {
        phase = 'locked';
        stateTimerTicks = RESET_DELAY_TICKS;
        events.push({
          type: 'locked',
          tick: nextTick,
          nodeId: nextNodeId,
          keysCollected,
        });
      }
      break;
    }

    const outs = index.outgoingByNode.get(nextNodeId);
    if (!outs || outs.length === 0) {
      throw new Error(`Node "${nextNodeId}" has no outgoing edges in level "${level.id}"`);
    }

    let chosen: LevelEdge | undefined;
    if (nextNode.type === 'gate') {
      chosen = outs.find((candidate) => candidate.branch === gateState) ?? outs[0];
      if (chosen) {
        events.push({
          type: 'gate-pass',
          tick: nextTick,
          nodeId: nextNodeId,
          branch: gateState,
          nextEdgeId: chosen.id,
        });
      }
    } else {
      chosen = outs[0];
    }

    if (!chosen) {
      throw new Error(`Unable to route from node "${nextNodeId}" in level "${level.id}"`);
    }

    edgeObj = chosen;
    currentEdgeId = chosen.id;
    edgeDistSim = overflow;
    checkEdgeItems(edgeObj, 0, Math.min(edgeDistSim, edgeObj.lengthSim));
  }

  return {
    state: {
      tick: nextTick,
      phase,
      gateState,
      clacks,
      clackTicks,
      keysMask,
      keysCollected,
      currentEdgeId,
      edgeDistSim,
      lastStepSim: stepSim,
      speedPerSecSim,
      speedRemainder,
      boostTicks,
      stateTimerTicks,
      edgeDirection: state.edgeDirection,
      jammedGateMask: state.jammedGateMask,
      scaleMask: state.scaleMask,
      portalHoldTicks: state.portalHoldTicks,
      portalTargetNodeId: state.portalTargetNodeId,
      jumpArcTicksRemaining: state.jumpArcTicksRemaining,
      jumpTargetEdgeId: state.jumpTargetEdgeId,
      jumpTargetSimPos: state.jumpTargetSimPos,
      itemCooldownTick: itemCooldownTick ?? state.itemCooldownTick,
    },
    events,
  };
}

export function step(level: LevelDef, state: SimState, clackThisTick = false): StepOutput {
  const index = getLevelIndex(level);
  return stepIndexed(level, index, state, clackThisTick);
}

// Pure deterministic FNV-1a 32-bit hash (zero platform-dependent APIs)
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function serializeCooldowns(cooldowns: Readonly<Record<string, number>>): string {
  return Object.keys(cooldowns)
    .sort()
    .map((id) => `${id}:${cooldowns[id] ?? 0}`)
    .join(',');
}

export function hashSimState(level: LevelDef, state: SimState): string {
  const payload = [
    level.id,
    String(level.day),
    String(state.tick),
    state.phase,
    state.gateState,
    String(state.clacks),
    state.clackTicks.join(','),
    String(state.keysMask),
    String(state.keysCollected),
    state.currentEdgeId,
    String(state.edgeDistSim),
    String(state.speedPerSecSim),
    String(state.speedRemainder),
    String(state.boostTicks),
    String(state.stateTimerTicks),
    String(state.edgeDirection),
    String(state.jammedGateMask),
    String(state.scaleMask),
    String(state.portalHoldTicks),
    state.portalTargetNodeId ?? '-',
    String(state.jumpArcTicksRemaining),
    state.jumpTargetEdgeId ?? '-',
    String(state.jumpTargetSimPos),
    serializeCooldowns(state.itemCooldownTick),
  ].join('|');
  return fnv1aHex(payload);
}

export function simulate(
  level: LevelDef,
  clackTicks: readonly number[],
  endTick: number
): SimResult {
  const index = getLevelIndex(level);
  const clampedEnd = Math.max(0, Math.trunc(endTick));

  const clackSet = new Set<number>();
  for (const rawTick of clackTicks) {
    const t = Math.trunc(rawTick);
    if (t >= 0 && t < clampedEnd) {
      clackSet.add(t);
    }
  }

  const launched = launchSim(createInitialState(level));
  let state = launched.state;
  const allEvents: SimEvent[] = [...launched.events];

  for (let t = 0; t < clampedEnd; t++) {
    if (state.phase === 'won' || state.phase === 'falling' || state.phase === 'locked') {
      break;
    }
    const out = stepIndexed(level, index, state, clackSet.has(t));
    state = out.state;
    for (const ev of out.events) {
      allEvents.push(ev);
    }
  }

  return {
    state,
    events: allEvents,
    won: state.phase === 'won',
    finishTick: state.tick,
    clacks: state.clacks,
    hash: hashSimState(level, state),
  };
}
