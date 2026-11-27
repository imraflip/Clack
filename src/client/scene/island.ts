import * as THREE from 'three';
import type { LevelDef } from '../../shared/levels';
import {
  BIOME_STONE_TONES,
  buildBiomeSatelliteDecoration,
  createPropMaterialPool,
} from './biomes';
import type { BiomeStoneTones, PropMaterialPool } from './biomes';
import { createSeededPRNG } from './prng';
import type { Rng } from './prng';

export const DECK_SIZE = 8.4;
export const HALF_DECK = DECK_SIZE / 2;

const DECK_CORNER_RADIUS = 0.56;
const RIM_OVERHANG = 0.14;
const RIM_BEVEL_SIZE = 0.055;
const RIM_BEVEL_THICKNESS = 0.055;
const RIM_BEVEL_SEGMENTS = 3;
const RIM_DEPTH = 0.24;

const CLIFF_TOP_INSET = 0.02;
const CLIFF_TOP_HALF = HALF_DECK - CLIFF_TOP_INSET; // 4.18 — hugs all 4 edges cleanly, 0.215 inset inside the 4.395 plinth rim
const CLIFF_CORNER_RADIUS = 0.64;
const CLIFF_MAIN_DEPTH = 4.28;
const SATELLITE_SEGMENTS = 7;

export type SatelliteVisual = {
  readonly group: THREE.Group;
  readonly baseY: number;
  readonly phase: number;
  readonly speed: number;
};

export type IslandBaseResult = {
  readonly satellites: readonly SatelliteVisual[];
};

function createRoundedSquareShape(size: number, radius: number): THREE.Shape {
  const s = size / 2;
  const r = radius;
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  return shape;
}

/**
 * Generates a clockwise (from +Y) rounded-square perimeter loop in XZ
 * matching the rounded corners of the wood deck so no sharp corner ever protrudes.
 */
function sampleRoundedSquarePerimeter(
  halfSize: number,
  cornerRadius: number
): ReadonlyArray<readonly [number, number]> {
  const r = Math.min(cornerRadius, halfSize * 0.45);
  const inner = halfSize - r;
  const pts: Array<readonly [number, number]> = [];

  const corners = [
    { cx: -inner, cz: -inner, startAng: Math.PI, endAng: Math.PI * 1.5 },
    { cx: inner, cz: -inner, startAng: Math.PI * 1.5, endAng: Math.PI * 2 },
    { cx: inner, cz: inner, startAng: 0, endAng: Math.PI * 0.5 },
    { cx: -inner, cz: inner, startAng: Math.PI * 0.5, endAng: Math.PI },
  ] as const;

  const arcSteps = 2; // 3 points per rounded corner (0°, 45°, 90°)
  const sideIntermediates = 3; // 3 intermediate points along each straight side

  for (let c = 0; c < corners.length; c++) {
    const corner = corners[c];
    const nextCorner = corners[(c + 1) % corners.length];
    if (!corner || !nextCorner) continue;

    for (let s = 0; s <= arcSteps; s++) {
      const ang = THREE.MathUtils.lerp(corner.startAng, corner.endAng, s / arcSteps);
      pts.push([corner.cx + Math.cos(ang) * r, corner.cz + Math.sin(ang) * r]);
    }

    const endX = corner.cx + Math.cos(corner.endAng) * r;
    const endZ = corner.cz + Math.sin(corner.endAng) * r;
    const nextStartX = nextCorner.cx + Math.cos(nextCorner.startAng) * r;
    const nextStartZ = nextCorner.cz + Math.sin(nextCorner.startAng) * r;

    for (let m = 1; m <= sideIntermediates; m++) {
      const f = m / (sideIntermediates + 1);
      pts.push([
        THREE.MathUtils.lerp(endX, nextStartX, f),
        THREE.MathUtils.lerp(endZ, nextStartZ, f),
      ]);
    }
  }

  return pts;
}

function sampleStoneGradient(
  cTop: THREE.Color,
  cMid: THREE.Color,
  cBot: THREE.Color,
  t: number,
  facetShade: number
): THREE.Color {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const col =
    clamped < 0.5
      ? cTop.clone().lerp(cMid, clamped * 2)
      : cMid.clone().lerp(cBot, (clamped - 0.5) * 2);
  col.offsetHSL(0, 0, facetShade);
  return col;
}

function createFacetedCliffGeometry(
  topHalf: number,
  cornerRadius: number,
  depth: number,
  rng: Rng,
  tones: BiomeStoneTones
): THREE.BufferGeometry {
  // Unique per-island geological ridge frequencies and phase offsets
  const ridgeFreqA = 2 + Math.floor(rng() * 3); // 2..4 ridges
  const ridgeFreqB = 3 + Math.floor(rng() * 3); // 3..5 secondary facets
  const phaseA = rng() * Math.PI * 2;
  const phaseB = rng() * Math.PI * 2;
  const strataSkewX = (rng() - 0.5) * 0.24;
  const strataSkewZ = (rng() - 0.5) * 0.24;

  // Balanced edge-hugging taper: starts cleanly along all 4 edges right beneath the plinth rim
  // (y = -0.57, half = 4.18 vs plinth outer 4.395), shows crisp rock facets below the front & side edges,
  // and tapers smoothly to a softly weathered stone keel rather than a needle-sharp spike.
  const rings = [
    { y: -0.57, scale: 1.0, ridgeAmp: 0.0, radialJitter: 0.0, yJitter: 0.0, maxRad: 1.0 },
    { y: -1.48, scale: 0.84, ridgeAmp: 0.05, radialJitter: 0.08, yJitter: 0.18, maxRad: 0.93 },
    { y: -2.44, scale: 0.58, ridgeAmp: 0.08, radialJitter: 0.11, yJitter: 0.22, maxRad: 0.7 },
    { y: -3.38, scale: 0.33, ridgeAmp: 0.08, radialJitter: 0.12, yJitter: 0.18, maxRad: 0.42 },
    { y: -depth, scale: 0.18, ridgeAmp: 0.05, radialJitter: 0.1, yJitter: 0.1, maxRad: 0.24 },
  ] as const;

  const basePerim = sampleRoundedSquarePerimeter(topHalf, cornerRadius);
  const count = basePerim.length;

  const ringVerts = rings.map((r, rIdx) =>
    basePerim.map(([px, pz]) => {
      if (rIdx === 0) {
        const inward = 1 - rng() * 0.015;
        return new THREE.Vector3(px * inward, r.y, pz * inward);
      }
      const ang = Math.atan2(pz, px);
      const ridgeWave =
        Math.sin(ang * ridgeFreqA + phaseA + rIdx * 0.5) * r.ridgeAmp +
        Math.cos(ang * ridgeFreqB + phaseB - rIdx * 0.35) * (r.ridgeAmp * 0.55);
      const jitter = (rng() - 0.5) * r.radialJitter;
      const rad = Math.min(r.maxRad, Math.max(0.04, r.scale * (1 + ridgeWave + jitter)));
      const shelfWave = Math.sin(ang * ridgeFreqA + phaseA) * (r.yJitter * 0.4);
      const jy = (rng() - 0.5) * r.yJitter + shelfWave;
      const leanFactor = rIdx >= 2 ? (rIdx - 1) * 0.16 : 0;
      return new THREE.Vector3(
        px * rad + strataSkewX * leanFactor,
        r.y + jy,
        pz * rad + strataSkewZ * leanFactor
      );
    })
  );

  const bottomTip = new THREE.Vector3(
    strataSkewX * 0.65 + (rng() - 0.5) * 0.14,
    -depth - 0.2 - rng() * 0.08,
    strataSkewZ * 0.65 + (rng() - 0.5) * 0.14
  );

  const positions: number[] = [];
  const colors: number[] = [];
  const cTop = new THREE.Color(tones.top);
  const cMid = new THREE.Color(tones.mid);
  const cBot = new THREE.Color(tones.bottom);

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const facetShade = (rng() - 0.5) * 0.065;
    for (const v of [a, b, c]) {
      const t = (-v.y - 0.55) / (depth - 0.15);
      const col = sampleStoneGradient(cTop, cMid, cBot, t, facetShade);
      colors.push(col.r, col.g, col.b);
    }
  };

  // Outward-facing CCW winding for clockwise-around-+Y perimeter rings
  for (let r = 0; r < ringVerts.length - 1; r++) {
    const upper = ringVerts[r];
    const lower = ringVerts[r + 1];
    if (!upper || !lower) continue;
    for (let i = 0; i < count; i++) {
      const n = (i + 1) % count;
      const uI = upper[i];
      const uN = upper[n];
      const lI = lower[i];
      const lN = lower[n];
      if (!uI || !uN || !lI || !lN) continue;
      pushTri(uI, uN, lI);
      pushTri(uN, lN, lI);
    }
  }

  const lastRing = ringVerts[ringVerts.length - 1];
  if (lastRing) {
    for (let i = 0; i < count; i++) {
      const n = (i + 1) % count;
      const a = lastRing[i];
      const b = lastRing[n];
      if (!a || !b) continue;
      pushTri(a, b, bottomTip);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a softly weathered, beveled low-poly rock shelf/lobe fused into the tapered cliff
 * (blunt faceted base instead of a sharp stalactite spike).
 */
function createSoftCragGeometry(
  topRadius: number,
  height: number,
  sides: number,
  rng: Rng,
  tones: BiomeStoneTones,
  topWorldY: number
): THREE.BufferGeometry {
  // Gentle stepped taper ending in a soft blunt stone base rather than a sharp needle point
  const rings = [
    { y: 0, rScale: 1.0, jitter: 0.08 },
    { y: -height * 0.46, rScale: 0.8, jitter: 0.12 },
    { y: -height * 0.86, rScale: 0.48, jitter: 0.12 },
  ] as const;

  const angleStep = (Math.PI * 2) / sides;
  const startAngle = rng() * Math.PI * 2;
  const stretchX = 0.9 + rng() * 0.2;
  const stretchZ = 0.9 + rng() * 0.2;

  const ringVerts = rings.map((r, rIdx) => {
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      const ang = startAngle + i * angleStep;
      const rad = topRadius * r.rScale * (1 + (rng() - 0.5) * r.jitter);
      const jy = rIdx === 0 ? 0 : (rng() - 0.5) * height * 0.06;
      verts.push(
        new THREE.Vector3(Math.cos(ang) * rad * stretchX, r.y + jy, Math.sin(ang) * rad * stretchZ)
      );
    }
    return verts;
  });

  // Shallow, gently beveled cap closing the bottom smoothly (not spiky)
  const tip = new THREE.Vector3(
    (rng() - 0.5) * topRadius * 0.12,
    -height,
    (rng() - 0.5) * topRadius * 0.12
  );

  const positions: number[] = [];
  const colors: number[] = [];
  const cTop = new THREE.Color(tones.top);
  const cMid = new THREE.Color(tones.mid);
  const cBot = new THREE.Color(tones.bottom);

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const facetShade = (rng() - 0.5) * 0.06;
    for (const v of [a, b, c]) {
      const worldY = topWorldY + v.y;
      const t = (-worldY - 0.55) / (CLIFF_MAIN_DEPTH - 0.15);
      const col = sampleStoneGradient(cTop, cMid, cBot, t, facetShade);
      colors.push(col.r, col.g, col.b);
    }
  };

  for (let r = 0; r < ringVerts.length - 1; r++) {
    const upper = ringVerts[r];
    const lower = ringVerts[r + 1];
    if (!upper || !lower) continue;
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides;
      const uI = upper[i];
      const uN = upper[n];
      const lI = lower[i];
      const lN = lower[n];
      if (!uI || !uN || !lI || !lN) continue;
      pushTri(uI, uN, lI);
      pushTri(uN, lN, lI);
    }
  }

  const lastRing = ringVerts[ringVerts.length - 1];
  if (lastRing) {
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides;
      const a = lastRing[i];
      const b = lastRing[n];
      if (!a || !b) continue;
      pushTri(a, b, tip);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Fuses 4 softly weathered rock shelves/lobes along the underside edges beneath the plinth
 * for organic chiseled silhouettes without sharp stalactite spikes.
 */
function populateUndersideCrags(
  islandRoot: THREE.Group,
  rng: Rng,
  tones: BiomeStoneTones
): void {
  const cragMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    flatShading: true,
  });

  const specs = [
    // Front-left weathered stone shelf
    { angMin: 1.98, angMax: 2.52, distMin: 2.2, distMax: 2.75, rMin: 0.65, rMax: 0.82, hMin: 1.35, hMax: 1.75, topY: -0.92 },
    // Front-right weathered stone shelf
    { angMin: 0.62, angMax: 1.16, distMin: 2.2, distMax: 2.75, rMin: 0.62, rMax: 0.8, hMin: 1.3, hMax: 1.7, topY: -0.92 },
    // Front-center stone ledge
    { angMin: 1.35, angMax: 1.8, distMin: 2.0, distMax: 2.45, rMin: 0.68, rMax: 0.85, hMin: 1.55, hMax: 1.95, topY: -0.98 },
    // Side/rear weathered counterweight lobe (visible on hover/tilt)
    { angMin: 3.55, angMax: 5.65, distMin: 1.85, distMax: 2.45, rMin: 0.65, rMax: 0.82, hMin: 1.45, hMax: 1.85, topY: -0.96 },
  ] as const;

  const safeHalf = CLIFF_TOP_HALF - 0.16; // 4.02 — strictly inside plinth outer 4.395

  for (const spec of specs) {
    const ang = THREE.MathUtils.lerp(spec.angMin, spec.angMax, rng());
    const dist = THREE.MathUtils.lerp(spec.distMin, spec.distMax, rng());
    const radius = THREE.MathUtils.lerp(spec.rMin, spec.rMax, rng());
    const height = THREE.MathUtils.lerp(spec.hMin, spec.hMax, rng());
    const sides = rng() > 0.45 ? 7 : 6;
    const topY = spec.topY - rng() * 0.14;

    const maxOffset = Math.max(0.4, safeHalf - radius * 1.24);
    const lx = THREE.MathUtils.clamp(Math.cos(ang) * dist, -maxOffset, maxOffset);
    const lz = THREE.MathUtils.clamp(Math.sin(ang) * dist, -maxOffset, maxOffset);

    const geo = createSoftCragGeometry(radius, height, sides, rng, tones, topY);
    const mesh = new THREE.Mesh(geo, cragMat);
    mesh.name = 'island-crag';
    mesh.position.set(lx, topY, lz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    islandRoot.add(mesh);
  }
}

/**
 * Builds a 100% watertight, seam-free tapered low-poly stone underside for a satellite islet.
 * Uses the exact same angular vertex phase (sin θ, cos θ) as CylinderGeometry so all 7 facets
 * align cleanly beneath the cap with zero UV-seam cracks or detached bottom caps.
 */
function createSatelliteStoneGeometry(
  topRadius: number,
  height: number,
  segments: number,
  rockRng: Rng,
  tones: BiomeStoneTones
): THREE.BufferGeometry {
  const ridgePhase = rockRng() * Math.PI * 2;
  const ridgeFreq = 2 + Math.floor(rockRng() * 2);

  // Rings descend from y = 0 (tucked cleanly inside cap bottom) down to -height * 0.84,
  // then close cleanly onto a single shared bottomTip at -height.
  const ringDefs = [
    { y: 0, rScale: 1.0, jitter: 0.0, yJitter: 0.0 },
    { y: -height * 0.34, rScale: 0.72, jitter: 0.14, yJitter: height * 0.06 },
    { y: -height * 0.68, rScale: 0.36, jitter: 0.16, yJitter: height * 0.06 },
  ] as const;

  const ringVerts = ringDefs.map((r, rIdx) => {
    const verts: THREE.Vector3[] = [];
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      let rad = topRadius * r.rScale;
      let vy = r.y;
      if (rIdx > 0) {
        const wave = Math.sin(theta * ridgeFreq + ridgePhase) * 0.09;
        const scaleMult = THREE.MathUtils.clamp(
          1 + wave + (rockRng() - 0.5) * r.jitter,
          0.65,
          1.12
        );
        rad = Math.min(topRadius * 0.96, rad * scaleMult);
        vy += (rockRng() - 0.5) * r.yJitter;
      }
      verts.push(new THREE.Vector3(Math.sin(theta) * rad, vy, Math.cos(theta) * rad));
    }
    return verts;
  });

  const bottomTip = new THREE.Vector3(
    (rockRng() - 0.5) * topRadius * 0.16,
    -height,
    (rockRng() - 0.5) * topRadius * 0.16
  );

  const positions: number[] = [];
  const colors: number[] = [];
  const cTop = new THREE.Color(tones.top);
  const cMid = new THREE.Color(tones.mid);
  const cBot = new THREE.Color(tones.bottom);

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const facetShade = (rockRng() - 0.5) * 0.06;
    for (const v of [a, b, c]) {
      const t = THREE.MathUtils.clamp(-v.y / Math.max(0.01, height), 0, 1);
      const col = sampleStoneGradient(cTop, cMid, cBot, t, facetShade);
      colors.push(col.r, col.g, col.b);
    }
  };

  // Seal the top ring cleanly onto a shared topCenter so the stone mesh is a 100% closed manifold
  const topCenter = new THREE.Vector3(0, 0, 0);
  const firstRing = ringVerts[0];
  if (firstRing) {
    for (let s = 0; s < segments; s++) {
      const n = (s + 1) % segments;
      const a = firstRing[s];
      const b = firstRing[n];
      if (!a || !b) continue;
      pushTri(a, b, topCenter);
    }
  }

  // Outward-facing CCW winding for counter-clockwise (sin θ, cos θ) rings
  for (let r = 0; r < ringVerts.length - 1; r++) {
    const upper = ringVerts[r];
    const lower = ringVerts[r + 1];
    if (!upper || !lower) continue;
    for (let s = 0; s < segments; s++) {
      const n = (s + 1) % segments;
      const uI = upper[s];
      const uN = upper[n];
      const lI = lower[s];
      const lN = lower[n];
      if (!uI || !uN || !lI || !lN) continue;
      pushTri(uI, lI, uN);
      pushTri(uN, lI, lN);
    }
  }

  // Seal the bottom cleanly onto the single shared tip (zero open seam)
  const lastRing = ringVerts[ringVerts.length - 1];
  if (lastRing) {
    for (let s = 0; s < segments; s++) {
      const n = (s + 1) % segments;
      const a = lastRing[s];
      const b = lastRing[n];
      if (!a || !b) continue;
      pushTri(a, bottomTip, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildSatelliteIslet(
  level: LevelDef,
  rng: Rng,
  rockRng: Rng,
  tones: BiomeStoneTones,
  pool: PropMaterialPool,
  x: number,
  y: number,
  z: number,
  scale: number,
  hasTree: boolean
): SatelliteVisual {
  const g = new THREE.Group();
  const pal = level.palette;

  // Grass/snow cap: 7-sided upright cylinder centered at y = 0.05 * scale (bottom at -0.06 * scale)
  const capTopR = 0.88 * scale;
  const capBottomR = 0.84 * scale;
  const capHeight = 0.22 * scale;
  const capY = 0.05 * scale;
  const capBottomY = capY - capHeight * 0.5;

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(capTopR, capBottomR, capHeight, SATELLITE_SEGMENTS),
    pool.standard({ color: pal.collar, roughness: 0.85, flatShading: true })
  );
  cap.position.y = capY;
  cap.castShadow = true;
  cap.receiveShadow = true;
  g.add(cap);

  // Watertight tapered stone underside cleanly inset ~11% narrower than cap bottom and tucked up inside cap
  const stoneTopR = capBottomR * 0.89;
  const stoneHeight = (1.35 + rockRng() * 0.35) * scale;
  const stoneGeo = createSatelliteStoneGeometry(
    stoneTopR,
    stoneHeight,
    SATELLITE_SEGMENTS,
    rockRng,
    tones
  );

  const stone = new THREE.Mesh(
    stoneGeo,
    pool.standard({ color: 0xffffff, vertexColors: true, roughness: 0.88, flatShading: true })
  );
  stone.name = 'satellite-stone';
  // Top ring of stoneGeo is at local y = 0 -> tuck 0.05 * scale up inside cap bottom for zero gap
  stone.position.y = capBottomY + 0.05 * scale;
  stone.castShadow = true;
  stone.receiveShadow = true;
  g.add(stone);

  const deco = buildBiomeSatelliteDecoration(level.biome, scale, hasTree, tones.top, rng, pool);
  g.add(deco);

  g.position.set(x, y, z);

  return {
    group: g,
    baseY: y,
    phase: rng() * Math.PI * 2,
    speed: 0.85 + rng() * 0.35,
  };
}

export function buildIslandBase(
  islandRoot: THREE.Group,
  level: LevelDef,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): IslandBaseResult {
  const pal = level.palette;
  const tones = BIOME_STONE_TONES[level.biome];
  const rockRng = createSeededPRNG(level.id, 0x9e3779b9);

  // Layer 1a: Beveled rounded-square top wood deck (flush top at y = 0)
  const deckShape = createRoundedSquareShape(DECK_SIZE, DECK_CORNER_RADIUS);
  const deckGeo = new THREE.ExtrudeGeometry(deckShape, {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.055,
    bevelSize: 0.055,
    bevelSegments: 3,
  });
  deckGeo.rotateX(Math.PI / 2);
  deckGeo.translate(0, -0.055, 0);
  const deckMesh = new THREE.Mesh(
    deckGeo,
    new THREE.MeshStandardMaterial({ color: pal.deck, roughness: 0.72, metalness: 0.03 })
  );
  deckMesh.receiveShadow = true;
  deckMesh.castShadow = true;
  islandRoot.add(deckMesh);

  // 4 Gleaming Metallic Brass Corner Rivets
  const rivetMat = new THREE.MeshStandardMaterial({
    color: 0xdfb14c,
    metalness: 0.88,
    roughness: 0.22,
  });
  const rivetGeo = new THREE.SphereGeometry(0.115, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const rivetCoords = [
    [-3.72, -3.72],
    [3.72, -3.72],
    [-3.72, 3.72],
    [3.72, 3.72],
  ] as const;
  for (const [rx, rz] of rivetCoords) {
    const rivet = new THREE.Mesh(rivetGeo, rivetMat);
    rivet.position.set(rx, 0, rz);
    rivet.castShadow = true;
    islandRoot.add(rivet);
  }

  // Layer 1b: Crafted wooden plinth lower rim stepping outward by 0.14 on all four sides
  // Concentric corner radius (0.56 + 0.14 = 0.70), top shoulder at y = -0.28, bottom at y = -0.63
  const rimShape = createRoundedSquareShape(
    DECK_SIZE + RIM_OVERHANG * 2,
    DECK_CORNER_RADIUS + RIM_OVERHANG
  );
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, {
    depth: RIM_DEPTH,
    bevelEnabled: true,
    bevelThickness: RIM_BEVEL_THICKNESS,
    bevelSize: RIM_BEVEL_SIZE,
    bevelSegments: RIM_BEVEL_SEGMENTS,
  });
  rimGeo.rotateX(Math.PI / 2);
  rimGeo.translate(0, -0.335, 0);
  const rimMesh = new THREE.Mesh(
    rimGeo,
    new THREE.MeshStandardMaterial({ color: pal.bevel, roughness: 0.74, metalness: 0.04 })
  );
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  islandRoot.add(rimMesh);

  // Layer 2: Sleek pointed chiseled stone cliff + 3 slender pointed underside rock spires
  const cliffGeo = createFacetedCliffGeometry(
    CLIFF_TOP_HALF,
    CLIFF_CORNER_RADIUS,
    CLIFF_MAIN_DEPTH,
    rockRng,
    tones
  );
  const cliffMesh = new THREE.Mesh(
    cliffGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true })
  );
  cliffMesh.name = 'island-cliff';
  cliffMesh.castShadow = true;
  cliffMesh.receiveShadow = true;
  islandRoot.add(cliffMesh);

  populateUndersideCrags(islandRoot, rockRng, tones);

  // 4 Floating Satellite Islets cleanly outside the 8.4x8.4 footprint
  const satellites: SatelliteVisual[] = [
    buildSatelliteIslet(level, rng, rockRng, tones, pool, -5.95, -0.25, -2.75, 0.92, true),
    buildSatelliteIslet(level, rng, rockRng, tones, pool, 5.95, -0.1, -2.45, 0.84, false),
    buildSatelliteIslet(level, rng, rockRng, tones, pool, -5.85, -0.52, 2.55, 0.76, false),
    buildSatelliteIslet(level, rng, rockRng, tones, pool, 5.85, -0.38, 2.65, 0.9, true),
  ];
  for (const s of satellites) {
    islandRoot.add(s.group);
  }

  return { satellites };
}

export function animateSatellites(
  satellites: readonly SatelliteVisual[],
  elapsed: number,
  reducedMotion: boolean
): void {
  if (reducedMotion) return;
  for (const s of satellites) {
    s.group.position.y = s.baseY + Math.sin(elapsed * s.speed + s.phase) * 0.14;
  }
}
