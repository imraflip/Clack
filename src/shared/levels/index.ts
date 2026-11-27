import { CORE_ISLANDS } from './core-islands';
import type { IslandId, LevelDef } from './types';

export type {
  BiomeId,
  BiomePalette,
  EdgeItem,
  EdgeItemBumper,
  EdgeItemJumpRamp,
  EdgeItemKey,
  EdgeItemSpring,
  GateBehavior,
  GateState,
  IslandId,
  IslandLayout,
  LevelCategory,
  LevelDef,
  LevelEdge,
  LevelNode,
  NodeType,
  PropSpec,
  PropType,
  TrackMode,
  Vec3,
} from './types';

export { CORE_ISLANDS } from './core-islands';

/** Ordered daily catalogue (Day 1 first). Twist islands append here in later phases. */
export const ISLANDS: readonly LevelDef[] = [...CORE_ISLANDS];

export function getIslandByIndex(index: number): LevelDef {
  const safeIdx = ((index % ISLANDS.length) + ISLANDS.length) % ISLANDS.length;
  const found = ISLANDS[safeIdx];
  if (!found) {
    throw new Error(`Invalid island index: ${index}`);
  }
  return found;
}

export function getIslandByDay(day: number): LevelDef | undefined {
  return ISLANDS.find((island) => island.day === day);
}

export function getIslandById(id: IslandId): LevelDef | undefined {
  return ISLANDS.find((island) => island.id === id);
}
