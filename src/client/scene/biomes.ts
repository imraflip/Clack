import * as THREE from 'three';
import type { BiomeId, PropSpec } from '../../shared/levels';
import type { Rng } from './prng';

export type BiomeStoneTones = {
  readonly top: number;
  readonly mid: number;
  readonly bottom: number;
};

export type BiomeGateTheme = {
  readonly hex: string;
  readonly darkHex: string;
  readonly shadowRgba: string;
};

/**
 * Harmonious single-color enamel/lacquer palette per biome shared by 3D gate caps
 * and the HUD CLACK button (replaces clashing red/blue state colors).
 */
export const BIOME_GATE_THEMES: Readonly<Record<BiomeId, BiomeGateTheme>> = {
  cedar: {
    hex: '#2d6a4c',
    darkHex: '#204f38',
    shadowRgba: 'rgba(45, 106, 76, 0.32)',
  },
  mossy: {
    hex: '#3d6e44',
    darkHex: '#2c5231',
    shadowRgba: 'rgba(61, 110, 68, 0.32)',
  },
  amber: {
    hex: '#b85324',
    darkHex: '#8c3d18',
    shadowRgba: 'rgba(184, 83, 36, 0.34)',
  },
  frosty: {
    hex: '#337391',
    darkHex: '#23556d',
    shadowRgba: 'rgba(51, 115, 145, 0.32)',
  },
  dusk: {
    hex: '#5c5082',
    darkHex: '#433963',
    shadowRgba: 'rgba(92, 80, 130, 0.34)',
  },
};

/**
 * Lifted, chiseled underside stone palettes per biome so angled low-poly facets
 * read crisply in soft bounce light instead of collapsing into flat dark shadow.
 */
export const BIOME_STONE_TONES: Readonly<Record<BiomeId, BiomeStoneTones>> = {
  cedar: {
    top: 0xbcb5aa,
    mid: 0xa49c91,
    bottom: 0x867f76,
  },
  mossy: {
    top: 0x93a3b0,
    mid: 0x7b8b98,
    bottom: 0x61717e,
  },
  amber: {
    top: 0xca9872,
    mid: 0xb3805c,
    bottom: 0x946749,
  },
  frosty: {
    top: 0xb0bdd1,
    mid: 0x97a6bc,
    bottom: 0x7c8ca4,
  },
  dusk: {
    top: 0x727996,
    mid: 0x5d6482,
    bottom: 0x484e6b,
  },
};

export type WaterwheelDrop = {
  readonly mesh: THREE.Mesh;
  readonly phase: number;
  readonly xOff: number;
};

export type WaterwheelVisual = {
  readonly root: THREE.Group;
  readonly wheel: THREE.Group;
  readonly drops: readonly WaterwheelDrop[];
};

export type BiomePropsResult = {
  readonly waterwheel: WaterwheelVisual | null;
};

export type StandardMatOptions = {
  readonly color: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly flatShading?: boolean;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  readonly side?: THREE.Side;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly vertexColors?: boolean;
};

export type PropMaterialPool = {
  readonly standard: (opts: StandardMatOptions) => THREE.MeshStandardMaterial;
  readonly ice: () => THREE.MeshPhysicalMaterial;
};

/**
 * Per-island shared material cache that eliminates redundant MeshStandardMaterial /
 * MeshPhysicalMaterial allocations across repeated trees, rocks, flowers, leaves, and islets.
 * All materials remain attached to the island root and dispose cleanly via disposeObjectTree().
 */
export function createPropMaterialPool(): PropMaterialPool {
  const stdCache = new Map<string, THREE.MeshStandardMaterial>();
  let iceMat: THREE.MeshPhysicalMaterial | null = null;

  const standard = (opts: StandardMatOptions): THREE.MeshStandardMaterial => {
    const key = [
      opts.color,
      opts.roughness ?? 0.85,
      opts.metalness ?? 0,
      opts.flatShading ? 1 : 0,
      opts.emissive ?? 0,
      opts.emissiveIntensity ?? 0,
      opts.side ?? THREE.FrontSide,
      opts.transparent ? 1 : 0,
      opts.opacity ?? 1,
      opts.vertexColors ? 1 : 0,
    ].join('|');

    const cached = stdCache.get(key);
    if (cached) return cached;

    const mat = new THREE.MeshStandardMaterial({
      color: opts.color,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0,
      flatShading: opts.flatShading ?? false,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      side: opts.side ?? THREE.FrontSide,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      vertexColors: opts.vertexColors ?? false,
    });
    stdCache.set(key, mat);
    return mat;
  };

  const ice = (): THREE.MeshPhysicalMaterial => {
    if (!iceMat) {
      iceMat = new THREE.MeshPhysicalMaterial({
        color: 0x8de0f5,
        roughness: 0.16,
        metalness: 0.05,
        transmission: 0.35,
        transparent: true,
        opacity: 0.88,
        flatShading: true,
      });
    }
    return iceMat;
  };

  return { standard, ice };
}

export function buildPineTree(
  scale: number,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055 * scale, 0.08 * scale, 0.34 * scale, 6),
    pool.standard({ color: 0x5c3e26, roughness: 0.9, flatShading: true })
  );
  trunk.position.y = 0.16 * scale;
  trunk.castShadow = true;
  g.add(trunk);

  const greens = [0x245940, 0x2f6f4f, 0x3b855f] as const;
  const tiers = [
    { r: 0.38, h: 0.56, y: 0.5 },
    { r: 0.3, h: 0.48, y: 0.78 },
    { r: 0.21, h: 0.4, y: 1.04 },
  ] as const;
  tiers.forEach((t, idx) => {
    const color = greens[idx] ?? 0x2f6f4f;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(t.r * scale, t.h * scale, 7),
      pool.standard({ color, roughness: 0.82, flatShading: true })
    );
    cone.position.y = t.y * scale;
    cone.rotation.y = rng() * Math.PI;
    cone.castShadow = true;
    cone.receiveShadow = true;
    g.add(cone);
  });
  return g;
}

export function buildBroadleafTree(
  scale: number,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065 * scale, 0.095 * scale, 0.46 * scale, 6),
    pool.standard({ color: 0x543c29, roughness: 0.92, flatShading: true })
  );
  trunk.position.y = 0.23 * scale;
  trunk.castShadow = true;
  g.add(trunk);

  const lobes = [
    { x: 0, y: 0.72, z: 0, r: 0.36, c: 0x346b46 },
    { x: 0.2, y: 0.62, z: 0.12, r: 0.25, c: 0x4c8c5b },
    { x: -0.19, y: 0.65, z: -0.1, r: 0.26, c: 0x3e7a4f },
    { x: 0.05, y: 0.92, z: -0.06, r: 0.23, c: 0x589b66 },
  ] as const;
  for (const l of lobes) {
    const m = new THREE.Mesh(
      new THREE.DodecahedronGeometry(l.r * scale, 0),
      pool.standard({ color: l.c, roughness: 0.84, flatShading: true })
    );
    m.position.set(l.x * scale, l.y * scale, l.z * scale);
    m.rotation.set(rng(), rng(), rng());
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

export function buildMapleTree(
  scale: number,
  rng: Rng,
  primaryColor = 0xd96134,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06 * scale, 0.09 * scale, 0.48 * scale, 6),
    pool.standard({ color: 0x623b26, roughness: 0.9, flatShading: true })
  );
  trunk.position.y = 0.24 * scale;
  trunk.castShadow = true;
  g.add(trunk);

  const palette = [primaryColor, 0xe07a32, 0xe5a93c, 0xc94a38] as const;
  const puffs = [
    { x: 0, y: 0.76, z: 0, r: 0.36 },
    { x: 0.22, y: 0.64, z: 0.14, r: 0.25 },
    { x: -0.22, y: 0.66, z: 0.06, r: 0.26 },
    { x: 0.02, y: 0.94, z: -0.1, r: 0.24 },
  ] as const;
  puffs.forEach((p, idx) => {
    const c = palette[idx % palette.length] ?? primaryColor;
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(p.r * scale, 0),
      pool.standard({ color: c, roughness: 0.8, flatShading: true })
    );
    m.position.set(p.x * scale, p.y * scale, p.z * scale);
    m.rotation.set(rng(), rng(), rng());
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });
  return g;
}

export function buildSnowSpruce(
  scale: number,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055 * scale, 0.08 * scale, 0.32 * scale, 6),
    pool.standard({ color: 0x5c4b42, roughness: 0.9, flatShading: true })
  );
  trunk.position.y = 0.16 * scale;
  trunk.castShadow = true;
  g.add(trunk);

  const tiers = [
    { r: 0.38, h: 0.56, y: 0.48, c: 0x2c5666 },
    { r: 0.29, h: 0.48, y: 0.78, c: 0x36697a },
    { r: 0.2, h: 0.38, y: 1.04, c: 0x457d8f },
  ] as const;
  const snowMat = pool.standard({
    color: 0xf4f9fc,
    roughness: 0.65,
    flatShading: true,
  });
  for (const t of tiers) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(t.r * scale, t.h * scale, 7),
      pool.standard({ color: t.c, roughness: 0.82, flatShading: true })
    );
    cone.position.y = t.y * scale;
    cone.rotation.y = rng() * Math.PI;
    cone.castShadow = true;
    g.add(cone);

    // Crisp white snow cap on each tier
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(t.r * 0.72 * scale, t.h * 0.48 * scale, 7),
      snowMat
    );
    cap.position.y = (t.y + t.h * 0.27) * scale;
    cap.rotation.y = cone.rotation.y;
    cap.castShadow = true;
    g.add(cap);
  }
  return g;
}

export function buildCypressTree(
  scale: number,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045 * scale, 0.065 * scale, 0.32 * scale, 6),
    pool.standard({ color: 0x422d22, roughness: 0.92, flatShading: true })
  );
  trunk.position.y = 0.16 * scale;
  trunk.castShadow = true;
  g.add(trunk);

  const lower = new THREE.Mesh(
    new THREE.ConeGeometry(0.24 * scale, 0.82 * scale, 7),
    pool.standard({ color: 0x244440, roughness: 0.85, flatShading: true })
  );
  lower.position.y = 0.64 * scale;
  lower.rotation.y = rng() * Math.PI;
  lower.castShadow = true;
  g.add(lower);

  const upper = new THREE.Mesh(
    new THREE.ConeGeometry(0.17 * scale, 0.78 * scale, 7),
    pool.standard({ color: 0x2f5750, roughness: 0.82, flatShading: true })
  );
  upper.position.y = 1.06 * scale;
  upper.rotation.y = rng() * Math.PI;
  upper.castShadow = true;
  g.add(upper);
  return g;
}

export function buildBoulder(
  scale: number,
  rng: Rng,
  color = 0x989ba1,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Mesh {
  const geo = new THREE.DodecahedronGeometry(0.28 * scale, 0);
  const pos = geo.getAttribute('position');
  if (pos instanceof THREE.BufferAttribute) {
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, pos.getY(i) * 0.72);
    }
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(
    geo,
    pool.standard({ color, roughness: 0.88, flatShading: true })
  );
  m.position.y = 0.13 * scale;
  m.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildCairn(
  scale: number,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Group {
  const g = new THREE.Group();
  const colors = [0x828c92, 0x76838a, 0x949ea4] as const;
  const sizes = [0.22, 0.15, 0.095] as const;
  let y = 0;
  sizes.forEach((r, idx) => {
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r * scale, 0),
      pool.standard({
        color: colors[idx] ?? 0x828c92,
        roughness: 0.88,
        flatShading: true,
      })
    );
    stone.scale.set(1.15, 0.56, 1.05);
    stone.position.set((rng() - 0.5) * 0.03, y + r * 0.48 * scale, (rng() - 0.5) * 0.03);
    stone.rotation.y = rng() * Math.PI;
    stone.castShadow = true;
    g.add(stone);
    y += r * 0.84 * scale;
  });
  return g;
}

export function buildIceCluster(
  scale: number,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Group {
  const g = new THREE.Group();
  const mat = pool.ice();
  const shards = [
    { x: 0, z: 0, r: 0.14, h: 0.62, rx: 0.08, rz: -0.06 },
    { x: 0.16, z: 0.08, r: 0.1, h: 0.42, rx: 0.24, rz: -0.22 },
    { x: -0.14, z: -0.06, r: 0.11, h: 0.46, rx: -0.18, rz: 0.2 },
  ] as const;
  for (const s of shards) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(s.r * scale, s.h * scale, 5), mat);
    mesh.position.set(s.x * scale, s.h * 0.46 * scale, s.z * scale);
    mesh.rotation.set(s.rx, rng() * Math.PI, s.rz);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

function buildStoneLantern(withLight: boolean, pool: PropMaterialPool): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = pool.standard({
    color: 0x6c6e7c,
    roughness: 0.9,
    flatShading: true,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), stoneMat);
  base.position.y = 0.05;
  base.castShadow = true;
  g.add(base);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.34, 6), stoneMat);
  post.position.y = 0.27;
  post.castShadow = true;
  g.add(post);

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.18, 0.16),
    pool.standard({
      color: 0xffd27d,
      emissive: 0xffbe55,
      emissiveIntensity: 1.5,
      roughness: 0.3,
    })
  );
  core.position.y = 0.52;
  g.add(core);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.16, 4), stoneMat);
  cap.position.y = 0.68;
  cap.rotation.y = Math.PI / 4;
  cap.castShadow = true;
  g.add(cap);

  if (withLight) {
    const pl = new THREE.PointLight(0xffb84d, 1.35, 3.8, 1.8);
    pl.position.set(0, 0.54, 0);
    g.add(pl);
  }
  return g;
}

function buildWoodenLanternPost(pool: PropMaterialPool): THREE.Group {
  const g = new THREE.Group();
  const wood = pool.standard({
    color: 0x6b4528,
    roughness: 0.85,
    flatShading: true,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.08), wood);
  post.position.y = 0.29;
  post.castShadow = true;
  g.add(post);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.055, 0.055), wood);
  arm.position.set(0.08, 0.56, 0);
  arm.castShadow = true;
  g.add(arm);

  const bulb = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.14, 0.11),
    pool.standard({
      color: 0xffe5a8,
      emissive: 0xffc864,
      emissiveIntensity: 0.65,
      roughness: 0.4,
    })
  );
  bulb.position.set(0.15, 0.46, 0);
  g.add(bulb);
  return g;
}

function buildWaterwheel(pool: PropMaterialPool): WaterwheelVisual {
  const root = new THREE.Group();
  const woodMat = pool.standard({
    color: 0x6b4a2e,
    roughness: 0.85,
    flatShading: true,
  });
  const darkWood = pool.standard({
    color: 0x4d341f,
    roughness: 0.9,
    flatShading: true,
  });

  // Timber mounting bracket protruding from island side
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.16), darkWood);
  beam.position.set(-0.22, 0, 0);
  beam.castShadow = true;
  root.add(beam);

  const wheel = new THREE.Group();
  wheel.name = 'spinning-wheel';

  const rim1 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 6, 16), woodMat);
  rim1.rotation.y = Math.PI / 2;
  rim1.position.x = -0.14;
  rim1.castShadow = true;
  wheel.add(rim1);

  const rim2 = rim1.clone();
  rim2.position.x = 0.14;
  wheel.add(rim2);

  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.46, 8), darkWood);
  axle.rotation.z = Math.PI / 2;
  wheel.add(axle);

  const spokeGeo = new THREE.BoxGeometry(0.05, 1.24, 0.06);
  const paddleGeo = new THREE.BoxGeometry(0.36, 0.045, 0.22);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, darkWood);
    spoke.rotation.x = a;
    wheel.add(spoke);

    const paddle = new THREE.Mesh(paddleGeo, woodMat);
    paddle.position.set(0, Math.sin(a) * 0.62, Math.cos(a) * 0.62);
    paddle.rotation.x = -a;
    paddle.castShadow = true;
    wheel.add(paddle);
  }

  root.add(wheel);

  // Shimmering animated water droplets
  const drops: WaterwheelDrop[] = [];
  const dropMat = pool.standard({
    color: 0xa8e6f0,
    emissive: 0x5cc5db,
    emissiveIntensity: 0.35,
    roughness: 0.2,
    transparent: true,
    opacity: 0.85,
  });
  const dropGeo = new THREE.SphereGeometry(0.055, 6, 6);
  for (let i = 0; i < 7; i++) {
    const mesh = new THREE.Mesh(dropGeo, dropMat);
    const phase = i / 7;
    const xOff = ((i % 3) - 1) * 0.1;
    mesh.position.set(xOff, 0.2 - phase * 1.45, 0.55 - phase * 0.25);
    mesh.scale.setScalar(1 - phase * 0.55);
    root.add(mesh);
    drops.push({ mesh, phase, xOff });
  }

  return { root, wheel, drops };
}

export function buildBiomeSatelliteDecoration(
  biome: BiomeId,
  scale: number,
  hasTree: boolean,
  cliffTopColor: number,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): THREE.Object3D {
  if (hasTree) {
    let tree: THREE.Group;
    if (biome === 'mossy') tree = buildBroadleafTree(0.62 * scale, rng, pool);
    else if (biome === 'amber') tree = buildMapleTree(0.62 * scale, rng, 0xe07a32, pool);
    else if (biome === 'frosty') tree = buildSnowSpruce(0.66 * scale, rng, pool);
    else if (biome === 'dusk') tree = buildCypressTree(0.66 * scale, rng, pool);
    else tree = buildPineTree(0.68 * scale, rng, pool);
    tree.position.y = 0.14 * scale;
    return tree;
  }

  const rock =
    biome === 'frosty'
      ? buildIceCluster(0.7 * scale, rng, pool)
      : buildBoulder(0.82 * scale, rng, cliffTopColor, pool);
  rock.position.y = 0.14 * scale;
  return rock;
}

export function populateBiomeProps(
  islandRoot: THREE.Group,
  props: readonly PropSpec[],
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): BiomePropsResult {
  let waterwheel: WaterwheelVisual | null = null;
  let sharedLeafGeo: THREE.PlaneGeometry | null = null;
  let sharedFlowerGeo: THREE.DodecahedronGeometry | null = null;

  for (const p of props) {
    const s = p.s ?? 1;
    let obj: THREE.Object3D | null = null;

    if (p.type === 'waterwheel') {
      const ww = buildWaterwheel(pool);
      ww.root.position.set(p.x, -0.35, p.z);
      islandRoot.add(ww.root);
      waterwheel = ww;
      continue;
    }

    switch (p.type) {
      case 'pineCluster': {
        const g = new THREE.Group();
        const t1 = buildPineTree(1.05 * s, rng, pool);
        const t2 = buildPineTree(0.72 * s, rng, pool);
        t2.position.set(0.42 * s, 0, 0.34 * s);
        const r = buildBoulder(0.75 * s, rng, 0x96989e, pool);
        r.position.set(-0.34 * s, 0, 0.26 * s);
        g.add(t1, t2, r);
        obj = g;
        break;
      }
      case 'pineSolo':
        obj = buildPineTree(s, rng, pool);
        break;
      case 'broadleafCluster': {
        const g = new THREE.Group();
        const t1 = buildBroadleafTree(1.02 * s, rng, pool);
        const t2 = buildBroadleafTree(0.72 * s, rng, pool);
        t2.position.set(0.44 * s, 0, 0.32 * s);
        const c = buildCairn(0.78 * s, rng, pool);
        c.position.set(-0.36 * s, 0, 0.28 * s);
        g.add(t1, t2, c);
        obj = g;
        break;
      }
      case 'broadleafSolo':
        obj = buildBroadleafTree(s, rng, pool);
        break;
      case 'cairn':
        obj = buildCairn(s, rng, pool);
        break;
      case 'mapleCluster': {
        const g = new THREE.Group();
        const t1 = buildMapleTree(1.04 * s, rng, 0xc94a38, pool);
        const t2 = buildMapleTree(0.74 * s, rng, 0xe5a93c, pool);
        t2.position.set(0.44 * s, 0, 0.3 * s);
        const r = buildBoulder(0.72 * s, rng, 0xb08a6a, pool);
        r.position.set(-0.32 * s, 0, 0.26 * s);
        g.add(t1, t2, r);
        obj = g;
        break;
      }
      case 'mapleSolo':
        obj = buildMapleTree(s, rng, p.color ?? 0xe07a32, pool);
        break;
      case 'sandPost': {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.11, 0.42, 6),
          pool.standard({ color: 0xc9966b, roughness: 0.86, flatShading: true })
        );
        post.position.y = 0.21;
        post.castShadow = true;
        obj = post;
        break;
      }
      case 'leaves': {
        const g = new THREE.Group();
        if (!sharedLeafGeo) {
          sharedLeafGeo = new THREE.PlaneGeometry(0.14, 0.09);
        }
        const leafColors = [0xc94a38, 0xe07a32, 0xe5a93c] as const;
        for (let i = 0; i < 6; i++) {
          const leaf = new THREE.Mesh(
            sharedLeafGeo,
            pool.standard({
              color: leafColors[i % leafColors.length] ?? 0xe07a32,
              roughness: 0.7,
              side: THREE.DoubleSide,
            })
          );
          leaf.rotation.x = -Math.PI / 2;
          leaf.rotation.z = rng() * Math.PI * 2;
          leaf.position.set((rng() - 0.5) * 0.75, 0.012, (rng() - 0.5) * 0.75);
          g.add(leaf);
        }
        obj = g;
        break;
      }
      case 'spruceCluster': {
        const g = new THREE.Group();
        const t1 = buildSnowSpruce(1.04 * s, rng, pool);
        const t2 = buildSnowSpruce(0.72 * s, rng, pool);
        t2.position.set(0.4 * s, 0, 0.32 * s);
        g.add(t1, t2);
        obj = g;
        break;
      }
      case 'spruceSolo':
        obj = buildSnowSpruce(s, rng, pool);
        break;
      case 'iceCluster':
        obj = buildIceCluster(s, rng, pool);
        break;
      case 'snowMound': {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.32 * s, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
          pool.standard({ color: 0xf4f9fc, roughness: 0.75, flatShading: true })
        );
        m.scale.set(1.25, 0.55, 1.0);
        m.receiveShadow = true;
        obj = m;
        break;
      }
      case 'cypressCluster': {
        const g = new THREE.Group();
        const t1 = buildCypressTree(1.08 * s, rng, pool);
        const t2 = buildCypressTree(0.76 * s, rng, pool);
        t2.position.set(0.36 * s, 0, 0.28 * s);
        const r = buildBoulder(0.7 * s, rng, 0x62667a, pool);
        r.position.set(-0.32 * s, 0, 0.22 * s);
        g.add(t1, t2, r);
        obj = g;
        break;
      }
      case 'cypressSolo':
        obj = buildCypressTree(s, rng, pool);
        break;
      case 'stoneLantern':
        obj = buildStoneLantern(Boolean(p.light), pool);
        break;
      case 'lanternPost':
        obj = buildWoodenLanternPost(pool);
        break;
      case 'boulder':
        obj = buildBoulder(s, rng, 0x96989e, pool);
        break;
      case 'flowers':
      case 'heather': {
        const g = new THREE.Group();
        if (!sharedFlowerGeo) {
          sharedFlowerGeo = new THREE.DodecahedronGeometry(0.052, 0);
        }
        const cols =
          p.type === 'heather'
            ? ([0x9f7db8, 0xb996cf, 0x7c679c] as const)
            : ([0xf7d768, 0xf5998c, 0xffffff] as const);
        for (let i = 0; i < 6; i++) {
          const dot = new THREE.Mesh(
            sharedFlowerGeo,
            pool.standard({
              color: cols[i % cols.length] ?? 0xffffff,
              roughness: 0.7,
            })
          );
          dot.position.set((rng() - 0.5) * 0.55, 0.035, (rng() - 0.5) * 0.55);
          g.add(dot);
        }
        obj = g;
        break;
      }
    }

    if (obj) {
      obj.position.set(p.x, 0, p.z);
      islandRoot.add(obj);
    }
  }

  return { waterwheel };
}

export function animateWaterwheel(
  waterwheel: WaterwheelVisual | null,
  elapsed: number,
  dt: number,
  reducedMotion: boolean
): void {
  if (!waterwheel || reducedMotion) return;
  waterwheel.wheel.rotation.x -= dt * 1.15;
  for (const d of waterwheel.drops) {
    const p = (d.phase + elapsed * 0.95) % 1;
    d.mesh.position.set(d.xOff, 0.2 - p * 1.45, 0.55 - p * 0.25);
    d.mesh.scale.setScalar(1 - p * 0.55);
  }
}
