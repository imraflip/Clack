import type { EdgeItem, LevelDef, LevelEdge, LevelNode, Vec3 } from './types';

function p3(x: number, z: number, y = 0): Vec3 {
  return { x, y, z };
}

function keyItem(lengthSim: number, u: number, keyId: number): EdgeItem {
  return {
    type: 'key',
    u,
    simPos: Math.round(lengthSim * u),
    triggerRadiusSim: Math.round(lengthSim * 0.085),
    keyId,
  };
}

function springItem(lengthSim: number, u: number, springId: string): EdgeItem {
  return {
    type: 'spring',
    u,
    simPos: Math.round(lengthSim * u),
    triggerRadiusSim: Math.round(lengthSim * 0.08),
    springId,
  };
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  branch: 'A' | 'B' | null,
  lengthSim: number,
  pts: readonly Vec3[],
  options?: { readonly bridge?: boolean; readonly items?: readonly EdgeItem[] }
): LevelEdge {
  const base: LevelEdge = {
    id,
    from,
    to,
    branch,
    lengthSim,
    pts,
    items: options?.items ?? [],
  };
  if (options?.bridge) {
    return { ...base, bridge: true };
  }
  return base;
}

function makeNodes(
  entries: ReadonlyArray<readonly [string, Vec3, LevelNode['type']]>
): Readonly<Record<string, LevelNode>> {
  const out: Record<string, LevelNode> = {};
  for (const [id, pos, type] of entries) {
    out[id] = { id, pos, type };
  }
  return out;
}

// ---------------------------------------------------------------------------
// DAY 1 — CEDAR COURTYARD (Par 2, Start A)
// ---------------------------------------------------------------------------
const CEDAR_ISLAND: LevelDef = {
  id: 'cedar',
  day: 1,
  category: 'daily',
  shortLabel: '1 Cedar',
  name: 'Cedar Courtyard',
  par: 2,
  totalKeys: 3,
  startState: 'A',
  seed: 101,
  dotColor: '#3b825d',
  biome: 'cedar',
  palette: {
    skyCenter: '#fff9f0',
    skyEdge: '#dce2f5',
    deck: 0xe2cda8,
    bevel: 0x7c4f2a,
    collar: 0x7ca668,
    cliffTop: 0xaba59c,
    cliffBottom: 0x7d776f,
    groove: 0x5c3c24,
    rail: 0x865936,
    sunColor: 0xfff3de,
    sunIntensity: 2.05,
    hemiSky: 0xdde7ff,
    hemiGround: 0xa6896b,
    hemiIntensity: 1.05,
  },
  nodes: makeNodes([
    ['start', p3(0, -3.3), 'start'],
    ['m1', p3(0, -2.5), 'merge'],
    ['g1', p3(0, -1.5), 'gate'],
    ['g2', p3(0.0, 0.8), 'gate'],
    ['g3', p3(0.2, 2.4), 'gate'],
    ['trap1', p3(2.5, 1.3), 'trapdoor'],
    ['trap2', p3(-0.6, 3.3), 'trapdoor'],
    ['bell', p3(2.5, 2.6), 'bell'],
  ]),
  edges: [
    makeEdge('e_start', 'start', 'm1', null, 800, [p3(0, -3.3), p3(0, -2.9), p3(0, -2.5)]),
    makeEdge('e_m1_g1', 'm1', 'g1', null, 1000, [p3(0, -2.5), p3(0, -2.0), p3(0, -1.5)]),
    makeEdge(
      'e_g1_a',
      'g1',
      'm1',
      'A',
      9385,
      [
        p3(0, -1.5),
        p3(-1.4, -1.5),
        p3(-2.8, -1.4),
        p3(-3.0, 0.1),
        p3(-1.7, 0.4),
        p3(-1.2, -1.0),
        p3(-0.75, -2.1),
        p3(0, -2.5),
      ],
      { items: [keyItem(9385, 0.44, 0)] }
    ),
    makeEdge(
      'e_g1_b',
      'g1',
      'g2',
      'B',
      7629,
      [p3(0, -1.5), p3(1.4, -1.5), p3(2.8, -1.4), p3(3.0, 0.1), p3(1.7, 0.8), p3(0.0, 0.8)],
      { items: [keyItem(7629, 0.38, 1), springItem(7629, 0.66, 'cedar_s1')] }
    ),
    makeEdge(
      'e_g2_b',
      'g2',
      'g3',
      'B',
      6907,
      [p3(0.0, 0.8), p3(-1.3, 0.85), p3(-2.4, 1.0), p3(-2.6, 2.5), p3(-1.1, 2.7), p3(0.2, 2.4)],
      { items: [keyItem(6907, 0.48, 2)] }
    ),
    makeEdge('e_g2_a', 'g2', 'trap1', 'A', 2555, [p3(0.0, 0.8), p3(1.3, 0.98), p3(2.5, 1.3)]),
    makeEdge('e_g3_a', 'g3', 'bell', 'A', 2312, [p3(0.2, 2.4), p3(1.35, 2.56), p3(2.5, 2.6)]),
    makeEdge('e_g3_b', 'g3', 'trap2', 'B', 1204, [p3(0.2, 2.4), p3(-0.22, 2.88), p3(-0.6, 3.3)]),
  ],
  props: [
    { type: 'pineCluster', x: -3.15, z: -3.05, s: 1.08 },
    { type: 'pineCluster', x: 2.95, z: -3.05, s: 1.02 },
    { type: 'pineCluster', x: -3.25, z: 3.2, s: 0.96 },
    { type: 'pineSolo', x: -2.05, z: -0.45, s: 0.85 },
    { type: 'pineSolo', x: 1.55, z: -0.45, s: 0.82 },
    { type: 'lanternPost', x: -1.45, z: -3.15 },
    { type: 'lanternPost', x: 1.45, z: -3.15 },
    { type: 'boulder', x: -1.35, z: 1.8, s: 0.92 },
    { type: 'boulder', x: 3.3, z: 2.0, s: 0.85 },
    { type: 'boulder', x: 1.2, z: 3.45, s: 0.78 },
    { type: 'flowers', x: -2.4, z: -2.45 },
    { type: 'flowers', x: 2.15, z: -2.45 },
    { type: 'flowers', x: -0.9, z: 1.75 },
  ],
};

// ---------------------------------------------------------------------------
// DAY 2 — MOSSY MILL (Par 3, Start A, Elevated Bridge + Spinning Waterwheel)
// ---------------------------------------------------------------------------
const MOSSY_ISLAND: LevelDef = {
  id: 'mossy',
  day: 2,
  category: 'daily',
  shortLabel: '2 Mossy',
  name: 'Mossy Mill',
  par: 3,
  totalKeys: 3,
  startState: 'A',
  seed: 202,
  dotColor: '#4f8452',
  biome: 'mossy',
  palette: {
    skyCenter: '#f6faf6',
    skyEdge: '#d4eae4',
    deck: 0xd4be98,
    bevel: 0x664c34,
    collar: 0x4f8452,
    cliffTop: 0x7d8a94,
    cliffBottom: 0x56626c,
    groove: 0x4e3927,
    rail: 0x75573c,
    sunColor: 0xf7faec,
    sunIntensity: 1.95,
    hemiSky: 0xd9f2ea,
    hemiGround: 0x6d7d66,
    hemiIntensity: 1.12,
  },
  nodes: makeNodes([
    ['start', p3(-1.5, -3.2), 'start'],
    ['m1', p3(0, -2.5), 'merge'],
    ['g1', p3(0, -1.6), 'gate'],
    ['g2', p3(2.2, -0.1), 'gate'],
    ['g3', p3(0.4, 2.3), 'gate'],
    ['g4', p3(-2.2, 2.7), 'gate'],
    ['trap1', p3(2.1, 3.2), 'trapdoor'],
    ['trap2', p3(-3.2, 3.0), 'trapdoor'],
    ['bell', p3(0.7, 3.1), 'bell'],
  ]),
  edges: [
    makeEdge('e_start', 'start', 'm1', null, 1661, [p3(-1.5, -3.2), p3(-0.75, -2.92), p3(0, -2.5)]),
    makeEdge('e_m1_g1', 'm1', 'g1', null, 900, [p3(0, -2.5), p3(0, -2.05), p3(0, -1.6)]),
    makeEdge(
      'e_g1_a',
      'g1',
      'g2',
      'A',
      9871,
      [
        p3(0, -1.6, 0),
        p3(-1.5, -1.6, 0),
        p3(-2.8, -1.5, 0),
        p3(-3.0, -0.1, 0),
        p3(-2.0, -0.1, 0.14),
        p3(-1.3, -0.1, 0.58),
        p3(0, -0.1, 0.58),
        p3(1.3, -0.1, 0.58),
        p3(1.85, -0.1, 0.16),
        p3(2.2, -0.1, 0),
      ],
      { bridge: true, items: [keyItem(9871, 0.34, 0)] }
    ),
    makeEdge(
      'e_g1_b',
      'g1',
      'g2',
      'B',
      4632,
      [p3(0, -1.6), p3(1.35, -1.6), p3(2.6, -1.6), p3(3.0, -0.8), p3(2.2, -0.1)],
      { items: [keyItem(4632, 0.42, 1), springItem(4632, 0.72, 'mossy_s1')] }
    ),
    makeEdge('e_g2_b', 'g2', 'g1', 'B', 6012, [
      p3(2.2, -0.1),
      p3(1.75, 1.1),
      p3(0.0, 1.25),
      p3(0.0, -0.1),
      p3(0.0, -0.9),
      p3(0.0, -1.6),
    ]),
    makeEdge('e_g2_a', 'g2', 'g3', 'A', 4693, [
      p3(2.2, -0.1),
      p3(2.9, 1.4),
      p3(2.0, 2.4),
      p3(0.4, 2.3),
    ]),
    makeEdge(
      'e_g3_a',
      'g3',
      'g4',
      'A',
      4066,
      [p3(0.4, 2.3), p3(-0.8, 2.15), p3(-2.3, 1.7), p3(-2.6, 2.25), p3(-2.2, 2.7)],
      { items: [keyItem(4066, 0.5, 2)] }
    ),
    makeEdge('e_g3_b', 'g3', 'trap1', 'B', 1925, [p3(0.4, 2.3), p3(1.3, 2.82), p3(2.1, 3.2)]),
    makeEdge('e_g4_b', 'g4', 'bell', 'B', 2966, [p3(-2.2, 2.7), p3(-0.8, 3.12), p3(0.7, 3.1)]),
    makeEdge('e_g4_a', 'g4', 'trap2', 'A', 1044, [p3(-2.2, 2.7), p3(-2.75, 2.86), p3(-3.2, 3.0)]),
  ],
  props: [
    { type: 'broadleafCluster', x: -3.2, z: -2.95, s: 1.04 },
    { type: 'broadleafCluster', x: 2.95, z: -2.95, s: 1.08 },
    { type: 'broadleafSolo', x: -1.5, z: -0.92, s: 0.78 },
    { type: 'broadleafSolo', x: -3.1, z: 1.05, s: 0.92 },
    { type: 'cairn', x: 1.45, z: -2.75, s: 1.0 },
    { type: 'cairn', x: -1.35, z: 0.95, s: 0.95 },
    { type: 'cairn', x: 3.3, z: 2.55, s: 0.9 },
    { type: 'boulder', x: 1.15, z: 0.55, s: 0.72 },
    { type: 'waterwheel', x: 4.38, z: 0.75 },
  ],
};

// ---------------------------------------------------------------------------
// DAY 3 — AMBER VIADUCT (Par 3, Start B, Elevated Viaduct Bridge)
// ---------------------------------------------------------------------------
const AMBER_ISLAND: LevelDef = {
  id: 'amber',
  day: 3,
  category: 'daily',
  shortLabel: '3 Amber',
  name: 'Amber Viaduct',
  par: 3,
  totalKeys: 3,
  startState: 'B',
  seed: 303,
  dotColor: '#d46734',
  biome: 'amber',
  palette: {
    skyCenter: '#fff7ee',
    skyEdge: '#f4d3be',
    deck: 0xe8c488,
    bevel: 0x8c4f2b,
    collar: 0xc48236,
    cliffTop: 0xb88560,
    cliffBottom: 0x875c40,
    groove: 0x6b3a1e,
    rail: 0x995830,
    sunColor: 0xffe6c4,
    sunIntensity: 2.15,
    hemiSky: 0xffe8d6,
    hemiGround: 0xa36d45,
    hemiIntensity: 1.02,
  },
  nodes: makeNodes([
    ['start', p3(0, -3.3), 'start'],
    ['m1', p3(0, -2.5), 'merge'],
    ['g1', p3(0, -1.6), 'gate'],
    ['g2', p3(2.2, 0.25), 'gate'],
    ['g3', p3(-2.2, 0.25), 'gate'],
    ['g4', p3(0.0, 2.3), 'gate'],
    ['trap1', p3(-3.0, 1.8), 'trapdoor'],
    ['trap2', p3(1.3, 3.2), 'trapdoor'],
    ['bell', p3(-2.2, 2.9), 'bell'],
  ]),
  edges: [
    makeEdge('e_start', 'start', 'm1', null, 800, [p3(0, -3.3), p3(0, -2.9), p3(0, -2.5)]),
    makeEdge('e_m1_g1', 'm1', 'g1', null, 900, [p3(0, -2.5), p3(0, -2.05), p3(0, -1.6)]),
    makeEdge(
      'e_g1_b',
      'g1',
      'g2',
      'B',
      5057,
      [p3(0, -1.6), p3(1.45, -1.6), p3(2.7, -1.6), p3(3.0, -0.4), p3(2.2, 0.25)],
      { items: [keyItem(5057, 0.56, 0)] }
    ),
    makeEdge(
      'e_g1_a',
      'g1',
      'g3',
      'A',
      5057,
      [p3(0, -1.6), p3(-1.45, -1.6), p3(-2.7, -1.6), p3(-3.0, -0.4), p3(-2.2, 0.25)],
      { items: [keyItem(5057, 0.44, 1), springItem(5057, 0.74, 'amber_s1')] }
    ),
    makeEdge('e_g2_a', 'g2', 'g1', 'A', 2967, [
      p3(2.2, 0.25),
      p3(1.35, -0.65),
      p3(0.45, -1.0),
      p3(0, -1.6),
    ]),
    makeEdge(
      'e_g2_b',
      'g2',
      'g4',
      'B',
      4763,
      [p3(2.2, 0.25), p3(2.8, 1.8), p3(1.7, 2.5), p3(0.0, 2.3)],
      { items: [keyItem(4763, 0.48, 2)] }
    ),
    makeEdge(
      'e_g3_a',
      'g3',
      'g2',
      'A',
      4784,
      [
        p3(-2.2, 0.25, 0),
        p3(-1.7, 0.25, 0.16),
        p3(-1.2, 0.25, 0.58),
        p3(0, 0.25, 0.58),
        p3(1.2, 0.25, 0.58),
        p3(1.7, 0.25, 0.16),
        p3(2.2, 0.25, 0),
      ],
      { bridge: true }
    ),
    makeEdge('e_g3_b', 'g3', 'trap1', 'B', 1771, [p3(-2.2, 0.25), p3(-2.75, 1.0), p3(-3.0, 1.8)]),
    makeEdge('e_g4_a', 'g4', 'bell', 'A', 2285, [p3(0.0, 2.3), p3(-1.2, 2.7), p3(-2.2, 2.9)]),
    makeEdge('e_g4_b', 'g4', 'trap2', 'B', 1582, [p3(0.0, 2.3), p3(0.7, 2.82), p3(1.3, 3.2)]),
  ],
  props: [
    { type: 'mapleCluster', x: -3.1, z: -3.0, s: 1.06 },
    { type: 'mapleCluster', x: 3.05, z: -3.0, s: 1.04 },
    { type: 'mapleCluster', x: 3.15, z: 3.05, s: 0.98 },
    { type: 'mapleSolo', x: -1.65, z: -0.75, s: 0.84, color: 0xe07a32 },
    { type: 'mapleSolo', x: -0.9, z: 1.32, s: 0.86, color: 0xc94a38 },
    { type: 'mapleSolo', x: 1.3, z: 1.35, s: 0.82, color: 0xe5a93c },
    { type: 'sandPost', x: -1.4, z: -3.1 },
    { type: 'sandPost', x: 1.4, z: -3.1 },
    { type: 'leaves', x: -3.25, z: 3.15 },
    { type: 'leaves', x: 2.2, z: -2.6 },
    { type: 'leaves', x: -2.15, z: -2.55 },
    { type: 'leaves', x: 2.3, z: 3.3 },
  ],
};

// ---------------------------------------------------------------------------
// DAY 4 — FROSTY TERRACE (Par 4, Start A, S-Curve Cascade + Ice Bridge)
// ---------------------------------------------------------------------------
const FROSTY_ISLAND: LevelDef = {
  id: 'frosty',
  day: 4,
  category: 'daily',
  shortLabel: '4 Frosty',
  name: 'Frosty Terrace',
  par: 4,
  totalKeys: 3,
  startState: 'A',
  seed: 404,
  dotColor: '#6dbcd8',
  biome: 'frosty',
  palette: {
    skyCenter: '#f7fbff',
    skyEdge: '#d4e0f6',
    deck: 0xebe6dc,
    bevel: 0x8b95a5,
    collar: 0xeef5f9,
    cliffTop: 0x9aa6b8,
    cliffBottom: 0x6f7c91,
    groove: 0x5c6675,
    rail: 0x8290a6,
    sunColor: 0xf4f9ff,
    sunIntensity: 2.05,
    hemiSky: 0xdceeff,
    hemiGround: 0x9ba7ba,
    hemiIntensity: 1.15,
  },
  nodes: makeNodes([
    ['start', p3(-2.1, -3.2), 'start'],
    ['m1', p3(-0.6, -2.5), 'merge'],
    ['g1', p3(-0.6, -2.0), 'gate'],
    ['g2', p3(-1.6, -0.3), 'gate'],
    ['g3', p3(2.4, 0.2), 'gate'],
    ['g4', p3(0.4, 1.2), 'gate'],
    ['g5', p3(-0.4, 2.6), 'gate'],
    ['trap1', p3(2.2, -2.2), 'trapdoor'],
    ['trap2', p3(-2.9, 0.8), 'trapdoor'],
    ['trap3', p3(3.1, -1.1), 'trapdoor'],
    ['trap4', p3(-2.1, 3.1), 'trapdoor'],
    ['bell', p3(2.3, 2.7), 'bell'],
  ]),
  edges: [
    makeEdge('e_start', 'start', 'm1', null, 1665, [
      p3(-2.1, -3.2),
      p3(-1.3, -2.92),
      p3(-0.6, -2.5),
    ]),
    makeEdge('e_m1_g1', 'm1', 'g1', null, 500, [
      p3(-0.6, -2.5),
      p3(-0.6, -2.25),
      p3(-0.6, -2.0),
    ]),
    makeEdge(
      'e_g1_a',
      'g1',
      'g2',
      'A',
      4653,
      [p3(-0.6, -2.0), p3(-1.85, -1.95), p3(-2.8, -1.7), p3(-2.7, -0.5), p3(-1.6, -0.3)],
      { items: [keyItem(4653, 0.56, 0)] }
    ),
    makeEdge('e_g1_b', 'g1', 'trap1', 'B', 2808, [
      p3(-0.6, -2.0),
      p3(0.85, -2.14),
      p3(2.2, -2.2),
    ]),
    makeEdge(
      'e_g2_b',
      'g2',
      'g3',
      'B',
      4473,
      [
        p3(-1.6, -0.3, 0),
        p3(-1.1, -0.3, 0.16),
        p3(-0.6, -0.3, 0.58),
        p3(0.4, -0.3, 0.58),
        p3(1.4, -0.3, 0.58),
        p3(1.95, -0.04, 0.18),
        p3(2.4, 0.2, 0),
      ],
      { bridge: true, items: [springItem(4473, 0.54, 'frosty_s1')] }
    ),
    makeEdge('e_g2_a', 'g2', 'trap2', 'A', 1709, [
      p3(-1.6, -0.3),
      p3(-2.35, 0.25),
      p3(-2.9, 0.8),
    ]),
    makeEdge(
      'e_g3_a',
      'g3',
      'g4',
      'A',
      4019,
      [p3(2.4, 0.2), p3(2.9, 1.5), p3(1.8, 1.6), p3(0.4, 1.2)],
      { items: [keyItem(4019, 0.44, 1)] }
    ),
    makeEdge('e_g3_b', 'g3', 'trap3', 'B', 1488, [
      p3(2.4, 0.2),
      p3(2.85, -0.45),
      p3(3.1, -1.1),
    ]),
    makeEdge(
      'e_g4_b',
      'g4',
      'g5',
      'B',
      5539,
      [p3(0.4, 1.2), p3(-1.6, 1.38), p3(-2.55, 2.18), p3(-1.4, 2.55), p3(-0.4, 2.6)],
      { items: [keyItem(5539, 0.5, 2)] }
    ),
    makeEdge('e_g4_a', 'g4', 'g1', 'A', 3637, [
      p3(0.4, 1.2),
      p3(0.4, 0.4),
      p3(0.4, -0.3),
      p3(0.32, -1.2),
      p3(-0.15, -1.65),
      p3(-0.6, -2.0),
    ]),
    makeEdge('e_g5_a', 'g5', 'bell', 'A', 2706, [p3(-0.4, 2.6), p3(1.0, 2.72), p3(2.3, 2.7)]),
    makeEdge('e_g5_b', 'g5', 'trap4', 'B', 1772, [p3(-0.4, 2.6), p3(-1.3, 2.86), p3(-2.1, 3.1)]),
  ],
  props: [
    { type: 'spruceCluster', x: 3.15, z: -3.05, s: 1.06 },
    { type: 'spruceCluster', x: -3.25, z: -3.0, s: 0.96 },
    { type: 'spruceSolo', x: -1.4, z: -1.18, s: 0.8 },
    { type: 'spruceSolo', x: 3.35, z: 3.15, s: 0.95 },
    { type: 'iceCluster', x: 1.55, z: -1.15, s: 1.05 },
    { type: 'iceCluster', x: -3.3, z: 2.85, s: 1.0 },
    { type: 'iceCluster', x: -0.95, z: 0.62, s: 0.85 },
    { type: 'snowMound', x: 0.65, z: -3.25, s: 1.1 },
    { type: 'snowMound', x: 1.25, z: 3.45, s: 0.95 },
    { type: 'snowMound', x: -3.35, z: -0.45, s: 0.85 },
  ],
};

// ---------------------------------------------------------------------------
// DAY 5 — HIGHLAND DUSK (Par 4, Start B, Grand Twilight Finale)
// ---------------------------------------------------------------------------
const DUSK_ISLAND: LevelDef = {
  id: 'dusk',
  day: 5,
  category: 'daily',
  shortLabel: '5 Dusk',
  name: 'Highland Dusk',
  par: 4,
  totalKeys: 3,
  startState: 'B',
  seed: 505,
  dotColor: '#7a6f9e',
  biome: 'dusk',
  palette: {
    skyCenter: '#f2d8e0',
    skyEdge: '#c4c8e8',
    deck: 0xc49a74,
    bevel: 0x543724,
    collar: 0x6e6b85,
    cliffTop: 0x4c5166,
    cliffBottom: 0x323647,
    groove: 0x422a1b,
    rail: 0x6b452d,
    sunColor: 0xffd5bc,
    sunIntensity: 1.85,
    hemiSky: 0xd0c6f0,
    hemiGround: 0x5e4a45,
    hemiIntensity: 1.0,
  },
  nodes: makeNodes([
    ['start', p3(0, -3.3), 'start'],
    ['m1', p3(0, -2.5), 'merge'],
    ['g1', p3(0, -1.6), 'gate'],
    ['g2', p3(1.7, 0.15), 'gate'],
    ['g3', p3(-1.7, 0.15), 'gate'],
    ['g4', p3(1.6, 1.5), 'gate'],
    ['g5', p3(-0.2, 2.7), 'gate'],
    ['trap1', p3(3.0, 1.4), 'trapdoor'],
    ['trap2', p3(-3.0, 1.4), 'trapdoor'],
    ['trap3', p3(3.25, 2.55), 'trapdoor'],
    ['trap4', p3(-2.1, 3.1), 'trapdoor'],
    ['bell', p3(1.85, 2.95), 'bell'],
  ]),
  edges: [
    makeEdge('e_start', 'start', 'm1', null, 800, [p3(0, -3.3), p3(0, -2.9), p3(0, -2.5)]),
    makeEdge('e_m1_g1', 'm1', 'g1', null, 900, [p3(0, -2.5), p3(0, -2.05), p3(0, -1.6)]),
    makeEdge(
      'e_g1_b',
      'g1',
      'g2',
      'B',
      5771,
      [p3(0, -1.6), p3(1.55, -1.6), p3(2.9, -1.6), p3(3.0, -0.2), p3(1.7, 0.15)],
      { items: [keyItem(5771, 0.44, 0), springItem(5771, 0.72, 'dusk_s1')] }
    ),
    makeEdge(
      'e_g1_a',
      'g1',
      'g3',
      'A',
      5771,
      [p3(0, -1.6), p3(-1.55, -1.6), p3(-2.9, -1.6), p3(-3.0, -0.2), p3(-1.7, 0.15)],
      { items: [keyItem(5771, 0.5, 1)] }
    ),
    makeEdge('e_g2_a', 'g2', 'g1', 'A', 2480, [
      p3(1.7, 0.15),
      p3(1.1, -0.65),
      p3(0.45, -1.05),
      p3(0, -1.6),
    ]),
    makeEdge('e_g2_b', 'g2', 'trap1', 'B', 1807, [p3(1.7, 0.15), p3(2.4, 0.75), p3(3.0, 1.4)]),
    makeEdge(
      'e_g3_b',
      'g3',
      'g4',
      'B',
      4005,
      [
        p3(-1.7, 0.15, 0),
        p3(-1.25, 0.22, 0.18),
        p3(-0.8, 0.3, 0.58),
        p3(0.1, 0.45, 0.58),
        p3(1.0, 0.85, 0.4),
        p3(1.6, 1.5, 0),
      ],
      { bridge: true }
    ),
    makeEdge('e_g3_a', 'g3', 'trap2', 'A', 1807, [p3(-1.7, 0.15), p3(-2.4, 0.75), p3(-3.0, 1.4)]),
    makeEdge(
      'e_g4_a',
      'g4',
      'g5',
      'A',
      5894,
      [p3(1.6, 1.5), p3(0.0, 1.7), p3(-2.1, 2.0), p3(-1.4, 2.55), p3(-0.2, 2.7)],
      { items: [keyItem(5894, 0.48, 2), springItem(5894, 0.74, 'dusk_s2')] }
    ),
    makeEdge('e_g4_b', 'g4', 'trap3', 'B', 1956, [p3(1.6, 1.5), p3(2.45, 2.02), p3(3.25, 2.55)]),
    makeEdge('e_g5_b', 'g5', 'bell', 'B', 2074, [p3(-0.2, 2.7), p3(0.85, 2.92), p3(1.85, 2.95)]),
    makeEdge('e_g5_a', 'g5', 'trap4', 'A', 1942, [p3(-0.2, 2.7), p3(-1.2, 2.9), p3(-2.1, 3.1)]),
  ],
  props: [
    { type: 'cypressCluster', x: -3.15, z: -3.05, s: 1.06 },
    { type: 'cypressCluster', x: 3.1, z: -3.05, s: 1.04 },
    { type: 'cypressSolo', x: -1.45, z: -0.78, s: 0.85 },
    { type: 'cypressSolo', x: -3.25, z: 3.0, s: 0.96 },
    { type: 'stoneLantern', x: -1.35, z: -3.05, light: true },
    { type: 'stoneLantern', x: 1.35, z: -3.05, light: true },
    { type: 'stoneLantern', x: -0.85, z: 1.05, light: false },
    { type: 'heather', x: -2.25, z: -2.45 },
    { type: 'heather', x: 2.25, z: -2.45 },
    { type: 'heather', x: 0.65, z: 3.45 },
    { type: 'boulder', x: 3.3, z: 3.35, s: 0.85 },
  ],
};

export const CORE_ISLANDS: readonly LevelDef[] = [
  CEDAR_ISLAND,
  MOSSY_ISLAND,
  AMBER_ISLAND,
  FROSTY_ISLAND,
  DUSK_ISLAND,
];
