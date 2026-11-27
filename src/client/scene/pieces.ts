import * as THREE from 'three';
import type { GateState, LevelDef, Vec3 } from '../../shared/levels';
import { BIOME_GATE_THEMES, createPropMaterialPool } from './biomes';
import type { PropMaterialPool } from './biomes';
import type { Rng } from './prng';
import type { TrackSystem } from './tracks';

export const MARBLE_RADIUS = 0.215;
export const CLACK_SWING_MS = 120;

export type GateVisual = {
  readonly id: string;
  readonly group: THREE.Group;
  readonly hubGroup: THREE.Group;
  readonly capMat: THREE.MeshStandardMaterial;
  readonly paddlePivot: THREE.Group;
  readonly carriageGroup: THREE.Group;
  readonly angleBlockA: number;
  readonly angleBlockB: number;
  fromAngle: number;
  targetAngle: number;
  swingElapsedMs: number;
  recoilTimer: number;
  hubScaleY: number;
  hubVelY: number;
  barScaleY: number;
  barVelY: number;
};

export type KeyVisual = {
  readonly keyId: number;
  readonly pos: THREE.Vector3;
  readonly mesh: THREE.Group;
  readonly ring: THREE.Mesh;
  collected: boolean;
  pickupAnim: number;
};

export type SpringVisual = {
  readonly springId: string;
  readonly pos: THREE.Vector3;
  readonly coilGroup: THREE.Group;
  popTimer: number;
};

export type BellVisual = {
  readonly group: THREE.Group;
  readonly pivot: THREE.Group;
  readonly pos: THREE.Vector3;
  ringTimer: number;
  shakeTimer: number;
};

export type BurstParticle = {
  readonly mesh: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  readonly vel: THREE.Vector3;
  life: number;
  readonly maxLife: number;
};

export type PiecesBundle = {
  readonly marble: THREE.Mesh;
  readonly contactShadow: THREE.Mesh;
  readonly gates: readonly GateVisual[];
  readonly keys: readonly KeyVisual[];
  readonly springs: readonly SpringVisual[];
  readonly bell: BellVisual | null;
  readonly textures: readonly THREE.Texture[];
  readonly syncGates: (state: GateState, instant: boolean) => void;
  readonly triggerGatePass: (gateId: string) => void;
  readonly triggerKeyPickup: (keyId: number, reducedMotion: boolean) => void;
  readonly triggerSpringPop: (springId: string, reducedMotion?: boolean) => void;
  readonly triggerBellRing: (reducedMotion: boolean) => void;
  readonly triggerBellLocked: () => void;
  readonly resetVisuals: (startPos: Vec3, startState: GateState) => void;
  readonly placeMarble: (
    pos: THREE.Vector3,
    tangent: THREE.Vector3,
    stepWorldDist: number,
    boostFrac?: number,
    reducedMotion?: boolean
  ) => void;
  readonly updateAnimations: (dt: number, elapsed: number, reducedMotion: boolean) => void;
  readonly disposeParticles: () => void;
};

function createGateCapTexture(state: GateState, fillHex: string): THREE.Texture {
  if (typeof document === 'undefined') {
    return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  }
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = fillHex;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#fffdf9';
    if (state === 'A') {
      // Bold crisp white circle
      ctx.beginPath();
      ctx.arc(64, 64, 28, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Bold crisp white diamond
      ctx.beginPath();
      ctx.moveTo(64, 30);
      ctx.lineTo(98, 64);
      ctx.lineTo(64, 98);
      ctx.lineTo(30, 64);
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMarbleTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  }
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#f5d27a');
    grad.addColorStop(0.41, '#d49d3b');
    grad.addColorStop(0.42, '#4a3118');
    grad.addColorStop(0.58, '#4a3118');
    grad.addColorStop(0.59, '#c78c2a');
    grad.addColorStop(1, '#e8be61');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);

    ctx.fillStyle = '#f2c868';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(16 + i * 32, 64, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildKeyMesh(pool: PropMaterialPool): THREE.Group {
  const g = new THREE.Group();
  const brass = pool.standard({
    color: 0xf4c44e,
    emissive: 0x5c3c00,
    emissiveIntensity: 0.25,
    metalness: 0.85,
    roughness: 0.22,
  });

  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.036, 10, 18), brass);
  bow.position.y = 0.28;
  bow.castShadow = true;
  g.add(bow);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.26, 8), brass);
  shaft.position.y = 0.06;
  shaft.castShadow = true;
  g.add(shaft);

  const tooth1 = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.038, 0.038), brass);
  tooth1.position.set(0.055, -0.02, 0);
  g.add(tooth1);

  const tooth2 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.034, 0.038), brass);
  tooth2.position.set(0.048, 0.05, 0);
  g.add(tooth2);

  return g;
}

function computeBellArchYaw(incomingTangent: THREE.Vector3): number {
  // Undirected angle of the incoming track centerline in XZ, wrapped to (-PI/2, PI/2]
  let lineAngle = Math.atan2(-incomingTangent.z, incomingTangent.x);
  if (lineAngle > Math.PI * 0.5) lineAngle -= Math.PI;
  if (lineAngle <= -Math.PI * 0.5) lineAngle += Math.PI;

  // Offset diagonally ~42° so posts sit cleanly back-left & front-right outside the twin rails,
  // clamped within [-45°, -40°] so the archway stays warmly open toward the front camera.
  const desired = lineAngle - THREE.MathUtils.degToRad(42);
  return THREE.MathUtils.clamp(
    desired,
    THREE.MathUtils.degToRad(-45),
    THREE.MathUtils.degToRad(-40)
  );
}

function buildBellArch(pos: Vec3, incomingTangent: THREE.Vector3): BellVisual {
  const g = new THREE.Group();
  const worldPos = new THREE.Vector3(pos.x, pos.y, pos.z);
  g.position.copy(worldPos);

  const timber = new THREE.MeshStandardMaterial({
    color: 0x6e4425,
    roughness: 0.8,
    flatShading: true,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xf2c14e,
    metalness: 0.84,
    roughness: 0.22,
  });
  const darkBrass = new THREE.MeshStandardMaterial({
    color: 0x996d22,
    metalness: 0.78,
    roughness: 0.32,
  });

  // Glowing golden goal pad centered directly at the bell endpoint
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.48, 0.035, 24),
    new THREE.MeshStandardMaterial({
      color: 0xf2c94c,
      emissive: 0xd99b1e,
      emissiveIntensity: 0.22,
      roughness: 0.4,
    })
  );
  pad.position.y = 0.022;
  pad.receiveShadow = true;
  g.add(pad);

  // Diagonal timber archway (~40°–45° open to camera) with wide 1.30 inner post span
  // so both pillars sit completely outside the twin wooden guide rails
  const archYaw = computeBellArchYaw(incomingTangent);
  const archGroup = new THREE.Group();
  archGroup.rotation.y = archYaw;

  const postWidth = 0.11;
  const postHeight = 0.88;
  const innerSpan = 1.3;
  const postOffsetX = (innerSpan + postWidth) * 0.5;

  const postL = new THREE.Mesh(new THREE.BoxGeometry(postWidth, postHeight, postWidth), timber);
  postL.position.set(-postOffsetX, postHeight * 0.5, 0);
  postL.castShadow = true;
  archGroup.add(postL);

  const postR = postL.clone();
  postR.position.x = postOffsetX;
  archGroup.add(postR);

  // Refined lighter crossbar + dark brass roof trim so pieces behind stay uncrowded
  const beam = new THREE.Mesh(new THREE.BoxGeometry(innerSpan + postWidth * 2 + 0.08, 0.11, 0.17), timber);
  beam.position.set(0, postHeight + 0.02, 0);
  beam.castShadow = true;
  archGroup.add(beam);

  const capTrim = new THREE.Mesh(
    new THREE.BoxGeometry(innerSpan + postWidth * 2 + 0.16, 0.045, 0.21),
    darkBrass
  );
  capTrim.position.set(0, postHeight + 0.095, 0);
  capTrim.castShadow = true;
  archGroup.add(capTrim);

  g.add(archGroup);

  // Hanging sculpted brass bell centered directly over the goal pad,
  // counter-turned gently toward the front camera for clear silhouette & swing readability
  const pivot = new THREE.Group();
  pivot.position.set(0, postHeight - 0.03, 0);
  pivot.rotation.y = archYaw * 0.35;

  const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 8), darkBrass);
  hanger.position.y = -0.06;
  pivot.add(hanger);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
    brass
  );
  dome.position.y = -0.19;
  dome.castShadow = true;
  pivot.add(dome);

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.245, 0.22, 18), brass);
  skirt.position.y = -0.3;
  skirt.castShadow = true;
  pivot.add(skirt);

  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), darkBrass);
  clapper.position.y = -0.41;
  pivot.add(clapper);

  g.add(pivot);

  return {
    group: g,
    pivot,
    pos: worldPos,
    ringTimer: 0,
    shakeTimer: 0,
  };
}

function buildTrapdoor(pos: Vec3, pool: PropMaterialPool): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos.x, pos.y, pos.z);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.39, 0.048, 12, 28),
    pool.standard({ color: 0xc9493e, roughness: 0.55, metalness: 0.25 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.036;
  g.add(rim);

  // Subtle charcoal inner collar framing the clean open pit (no striped grate bars)
  const innerLip = new THREE.Mesh(
    new THREE.TorusGeometry(0.345, 0.022, 8, 28),
    pool.standard({ color: 0x26252b, roughness: 0.72, metalness: 0.35 })
  );
  innerLip.rotation.x = Math.PI / 2;
  innerLip.position.y = 0.034;
  g.add(innerLip);

  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.355, 0.355, 0.034, 28),
    pool.standard({ color: 0x111014, roughness: 0.98 })
  );
  pit.position.y = 0.02;
  g.add(pit);

  return g;
}

function buildSpringPad(
  springId: string,
  pos: THREE.Vector3,
  tangent: THREE.Vector3,
  pool: PropMaterialPool
): { readonly group: THREE.Group; readonly visual: SpringVisual } {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.position.y += 0.026;
  g.rotation.y = Math.atan2(tangent.x, tangent.z);

  const brassMat = pool.standard({
    color: 0xdca538,
    metalness: 0.85,
    roughness: 0.24,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.04, 16), brassMat);
  base.position.y = 0.02;
  g.add(base);

  const coilGroup = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 8, 16), brassMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.055 + i * 0.048;
    coilGroup.add(ring);
  }
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.21, 0.042, 16),
    new THREE.MeshStandardMaterial({ color: 0xf4ca62, metalness: 0.88, roughness: 0.18 })
  );
  cap.position.y = 0.2;
  cap.castShadow = true;
  coilGroup.add(cap);

  g.add(coilGroup);

  return {
    group: g,
    visual: {
      springId,
      pos: pos.clone(),
      coilGroup,
      popTimer: 0,
    },
  };
}

function shortestAngleDelta(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function buildPieces(
  islandRoot: THREE.Group,
  level: LevelDef,
  tracks: TrackSystem,
  rng: Rng,
  pool: PropMaterialPool = createPropMaterialPool()
): PiecesBundle {
  const gateTheme = BIOME_GATE_THEMES[level.biome];
  const capTexA = createGateCapTexture('A', gateTheme.hex);
  const capTexB = createGateCapTexture('B', gateTheme.hex);
  const marbleTex = createMarbleTexture();
  const textures: readonly THREE.Texture[] = [capTexA, capTexB, marbleTex];

  // Shared single gate cap material across all gates on the island (all gates share state A/B)
  const sharedGateCapMat = new THREE.MeshStandardMaterial({
    map: level.startState === 'A' ? capTexA : capTexB,
    roughness: 0.26,
    metalness: 0.08,
  });

  const keys: KeyVisual[] = [];
  const springs: SpringVisual[] = [];
  const gates: GateVisual[] = [];
  let bell: BellVisual | null = null;

  // Build track items (Keys & Springs)
  for (const edge of level.edges) {
    const seg = tracks.segmentsById.get(edge.id);
    if (!seg) continue;

    for (const item of edge.items) {
      const pt = seg.curve.getPointAt(item.u);
      const tan = seg.curve.getTangentAt(item.u).normalize();

      if (item.type === 'key') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.24, 0.025, 8, 22),
          pool.standard({
            color: 0xf4c44e,
            emissive: 0xd1941a,
            emissiveIntensity: 0.45,
            metalness: 0.75,
            roughness: 0.28,
          })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(pt.x, pt.y + 0.032, pt.z);
        islandRoot.add(ring);

        const keyMesh = buildKeyMesh(pool);
        keyMesh.position.set(pt.x, pt.y + 0.24, pt.z);
        islandRoot.add(keyMesh);

        keys.push({
          keyId: item.keyId,
          pos: pt.clone(),
          mesh: keyMesh,
          ring,
          collected: false,
          pickupAnim: 0,
        });
      } else if (item.type === 'spring') {
        const builtSpring = buildSpringPad(item.springId, pt, tan, pool);
        islandRoot.add(builtSpring.group);
        springs.push(builtSpring.visual);
      }
    }
  }

  // Build hero node pieces (Start cradle, Gates, Trapdoors, Bell)
  for (const [nodeId, nodeDef] of Object.entries(level.nodes)) {
    if (nodeDef.type === 'start') {
      const startBrassMat = pool.standard({ color: 0xd9a43a, metalness: 0.85, roughness: 0.24 });
      const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.055, 10, 24), startBrassMat);
      cradle.rotation.x = Math.PI / 2;
      cradle.position.set(nodeDef.pos.x, 0.052, nodeDef.pos.z);
      cradle.castShadow = true;
      islandRoot.add(cradle);

      // Subtle sculpted brass directional pointer on the Start cradle rim showing initial launch direction
      const startSeg = tracks.outgoingByNode.get(nodeId)?.[0];
      if (startSeg) {
        const startTan = startSeg.curve.getTangentAt(0.05).normalize();
        const dirGroup = new THREE.Group();
        dirGroup.name = 'start-direction-pointer';
        dirGroup.position.set(nodeDef.pos.x, nodeDef.pos.y + 0.056, nodeDef.pos.z);
        dirGroup.rotation.y = Math.atan2(startTan.x, startTan.z);

        const needle = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.16, 4), startBrassMat);
        needle.rotation.x = Math.PI / 2;
        needle.scale.set(1, 1, 0.45);
        needle.position.set(0, 0, 0.44);
        needle.castShadow = true;
        dirGroup.add(needle);
        islandRoot.add(dirGroup);
      }
    } else if (nodeDef.type === 'trapdoor') {
      islandRoot.add(buildTrapdoor(nodeDef.pos, pool));
    } else if (nodeDef.type === 'bell') {
      const incomingEdge = level.edges.find((e) => e.to === nodeId);
      const incomingSeg = incomingEdge ? tracks.segmentsById.get(incomingEdge.id) : undefined;
      const incomingTan = incomingSeg
        ? incomingSeg.curve.getTangentAt(0.98).normalize()
        : new THREE.Vector3(1, 0, 0);
      bell = buildBellArch(nodeDef.pos, incomingTan);
      islandRoot.add(bell.group);
    } else if (nodeDef.type === 'gate') {
      const outs = tracks.outgoingByNode.get(nodeId) ?? [];
      const edgeA = outs.find((e) => e.edge.branch === 'A');
      const edgeB = outs.find((e) => e.edge.branch === 'B');
      const tanA = edgeA ? edgeA.curve.getTangentAt(0.03).normalize() : new THREE.Vector3(-1, 0, 0);
      const tanB = edgeB ? edgeB.curve.getTangentAt(0.03).normalize() : new THREE.Vector3(1, 0, 0);

      const angleBlockA = Math.atan2(-tanA.z, tanA.x);
      const angleBlockB = Math.atan2(-tanB.z, tanB.x);

      const gateGroup = new THREE.Group();
      gateGroup.name = `gate-${nodeId}`;
      gateGroup.position.set(nodeDef.pos.x, nodeDef.pos.y, nodeDef.pos.z);

      const brassTrimMat = pool.standard({
        color: 0xdba63b,
        metalness: 0.86,
        roughness: 0.22,
      });
      const brassPlateMat = pool.standard({
        color: 0xc29032,
        metalness: 0.8,
        roughness: 0.28,
      });

      // Gleaming outer brass track ring framing the spring-loaded 3D gate hub
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.044, 12, 28), brassTrimMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.042;
      ring.castShadow = true;
      ring.receiveShadow = true;
      gateGroup.add(ring);

      // Subtle brass socket recess under the plunger so retracting flat looks mechanically seated
      const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.016, 22), brassPlateMat);
      socket.position.y = 0.008;
      socket.receiveShadow = true;
      gateGroup.add(socket);

      // Spring-loaded 3D wooden hub + raised biome enamel cap:
      // stands tall & chunky at rest, presses smoothly flat under the marble's weight as it rolls over,
      // then springs playfully back up once the marble clears the gate.
      const hubGroup = new THREE.Group();
      hubGroup.name = 'gate-hub-plunger';

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.21, 0.16, 18),
        pool.standard({ color: 0x6b4528, roughness: 0.72 })
      );
      hub.position.y = 0.08;
      hub.castShadow = true;
      hub.receiveShadow = true;
      hubGroup.add(hub);

      const capMat = sharedGateCapMat;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.09, 24), capMat);
      cap.name = 'gate-emblem-cap';
      cap.position.y = 0.2;
      cap.rotation.y = Math.PI / 2;
      cap.castShadow = true;
      cap.receiveShadow = true;
      hubGroup.add(cap);

      gateGroup.add(hubGroup);

      // Connected T-bar deflector gate: cream-ivory radial stem physically joining the center hub
      // to the outer rim carriage & perpendicular bumper bar, with damped bump vibration on gate-pass
      // AND spring-loaded flat retraction whenever the marble rolls directly over the T-bar.
      const paddlePivot = new THREE.Group();
      paddlePivot.name = 'gate-orbit-pivot';

      const ivoryMat = pool.standard({ color: 0xf7f1e3, roughness: 0.42 });
      const bumperDarkMat = pool.standard({
        color: 0x5c3c24,
        roughness: 0.65,
      });

      // Radial T-bar stem arm anchored cleanly into the center wooden hub wall (x = 0.14 -> 0.405)
      // Positioned cleanly at y = 0.07..0.135 so it visibly joins hub & crossbar without clipping the marble over the hub
      const stemArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.064, 0.11), ivoryMat);
      stemArm.name = 'gate-tbar-stem';
      stemArm.position.set(0.265, 0.102, 0);
      stemArm.castShadow = true;
      stemArm.receiveShadow = true;
      paddlePivot.add(stemArm);

      // Brass pivot collar band where the T-bar stem couples onto the center hub
      const stemCollar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.222, 0.228, 0.056, 22),
        brassTrimMat
      );
      stemCollar.position.y = 0.088;
      stemCollar.castShadow = true;
      paddlePivot.add(stemCollar);

      const carriageGroup = new THREE.Group();
      carriageGroup.position.x = 0.405;

      // Brass rim slider carriage gripping the circular outer track ring
      const rimShoe = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.06, 0.28), brassTrimMat);
      rimShoe.position.y = 0.062;
      rimShoe.castShadow = true;
      rimShoe.receiveShadow = true;
      carriageGroup.add(rimShoe);

      // Center ivory bridge riser linking the radial stem arm cleanly up into the bumper crossbar
      const centerRiser = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.11), ivoryMat);
      centerRiser.position.set(-0.015, 0.145, 0);
      centerRiser.castShadow = true;
      carriageGroup.add(centerRiser);

      // Twin brass support posts lifting the bumper bar to marble-equator height
      const postGeo = new THREE.CylinderGeometry(0.026, 0.032, 0.12, 8);
      for (const side of [-1, 1] as const) {
        const post = new THREE.Mesh(postGeo, brassTrimMat);
        post.position.set(0, 0.13, side * 0.155);
        post.castShadow = true;
        carriageGroup.add(post);
      }

      // Perpendicular cream-ivory bumper bar spanning rail-to-rail across the blocked mouth
      const barrierBar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.125, 0.45), ivoryMat);
      barrierBar.name = 'gate-deflector-bar';
      barrierBar.position.y = 0.205;
      barrierBar.castShadow = true;
      barrierBar.receiveShadow = true;
      carriageGroup.add(barrierBar);

      // Dark wood bumper face strip along the impact side of the crossbar
      const bumperFace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.044, 0.36), bumperDarkMat);
      bumperFace.position.y = 0.205;
      carriageGroup.add(bumperFace);

      // Gleaming brass end caps + crown rivet on the crossbar
      const endCapGeo = new THREE.CylinderGeometry(0.046, 0.046, 0.135, 10);
      for (const side of [-1, 1] as const) {
        const endCap = new THREE.Mesh(endCapGeo, brassTrimMat);
        endCap.position.set(0, 0.205, side * 0.225);
        endCap.castShadow = true;
        carriageGroup.add(endCap);
      }

      const crownRivet = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), brassTrimMat);
      crownRivet.position.y = 0.273;
      crownRivet.castShadow = true;
      carriageGroup.add(crownRivet);

      paddlePivot.add(carriageGroup);
      gateGroup.add(paddlePivot);
      islandRoot.add(gateGroup);

      const initAngle = level.startState === 'A' ? angleBlockB : angleBlockA;
      paddlePivot.rotation.y = initAngle;

      gates.push({
        id: nodeId,
        group: gateGroup,
        hubGroup,
        capMat,
        paddlePivot,
        carriageGroup,
        angleBlockA,
        angleBlockB,
        fromAngle: initAngle,
        targetAngle: initAngle,
        swingElapsedMs: CLACK_SWING_MS,
        recoilTimer: 0,
        hubScaleY: 1,
        hubVelY: 0,
        barScaleY: 1,
        barVelY: 0,
      });
    }
  }

  // Gleaming banded brass marble + grounded contact shadow
  const marbleMat = new THREE.MeshStandardMaterial({
    map: marbleTex,
    emissive: 0xffc84a,
    emissiveIntensity: 0,
    metalness: 0.78,
    roughness: 0.22,
  });
  const marble = new THREE.Mesh(new THREE.SphereGeometry(MARBLE_RADIUS, 26, 20), marbleMat);
  marble.castShadow = true;
  islandRoot.add(marble);

  const contactShadowMat = new THREE.MeshBasicMaterial({
    color: 0x1a120a,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(MARBLE_RADIUS * 1.12, 18),
    contactShadowMat
  );
  contactShadow.rotation.x = -Math.PI / 2;
  islandRoot.add(contactShadow);

  const GATE_RECOIL_SEC = 0.26;
  const SPRING_HOP_SEC = 0.34;
  const SPRING_HOP_HEIGHT = 0.24;
  let marbleHopTimer = 0;
  let boostTrailDistAccum = 0;

  // Golden burst particle pool (shared geometry, per-particle material disposed cleanly)
  const particleGeo = new THREE.OctahedronGeometry(0.065, 0);
  const particles: BurstParticle[] = [];

  const spawnGoldenBurst = (origin: THREE.Vector3, count: number, reducedMotion: boolean): void => {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xffd659 : 0xfff3b8,
        transparent: true,
        opacity: 1,
      });
      const m = new THREE.Mesh(particleGeo, mat);
      m.position.copy(origin);
      const angle = (i / count) * Math.PI * 2 + rng() * 0.4;
      const spd = 1.1 + rng() * 1.4;
      islandRoot.add(m);
      particles.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(angle) * spd, 1.8 + rng() * 1.4, Math.sin(angle) * spd),
        life: 0,
        maxLife: 0.55 + rng() * 0.25,
      });
    }
  };

  const syncGates = (state: GateState, instant: boolean): void => {
    for (const gate of gates) {
      gate.capMat.map = state === 'A' ? capTexA : capTexB;
      gate.capMat.needsUpdate = true;

      const desired = state === 'A' ? gate.angleBlockB : gate.angleBlockA;
      if (instant) {
        gate.fromAngle = desired;
        gate.targetAngle = desired;
        gate.swingElapsedMs = CLACK_SWING_MS;
        gate.paddlePivot.rotation.y = desired;
      } else {
        gate.fromAngle = gate.paddlePivot.rotation.y;
        gate.targetAngle = gate.fromAngle + shortestAngleDelta(gate.fromAngle, desired);
        gate.swingElapsedMs = 0;
      }
    }
  };

  const triggerGatePass = (gateId: string): void => {
    const rec = gates.find((g) => g.id === gateId);
    if (!rec) return;
    rec.recoilTimer = GATE_RECOIL_SEC;
  };

  const triggerKeyPickup = (keyId: number, reducedMotion: boolean): void => {
    const rec = keys.find((k) => k.keyId === keyId);
    if (!rec || rec.collected) return;
    rec.collected = true;
    rec.ring.visible = false;
    if (reducedMotion) {
      rec.pickupAnim = 1;
      rec.mesh.visible = false;
    } else {
      spawnGoldenBurst(rec.pos.clone().add(new THREE.Vector3(0, 0.25, 0)), 14, reducedMotion);
    }
  };

  const triggerSpringPop = (springId: string, reducedMotion = false): void => {
    const rec = springs.find((s) => s.springId === springId);
    if (rec) {
      rec.popTimer = 0.35;
    }
    if (!reducedMotion) {
      marbleHopTimer = SPRING_HOP_SEC;
    }
  };

  const triggerBellRing = (reducedMotion: boolean): void => {
    if (!bell) return;
    bell.ringTimer = 1.4;
    spawnGoldenBurst(bell.pos.clone().add(new THREE.Vector3(0, 0.45, 0)), 24, reducedMotion);
  };

  const triggerBellLocked = (): void => {
    if (!bell) return;
    bell.shakeTimer = 0.42;
  };

  const resetVisuals = (startPos: Vec3, startState: GateState): void => {
    for (const k of keys) {
      k.collected = false;
      k.pickupAnim = 0;
      k.mesh.visible = true;
      k.mesh.scale.set(1, 1, 1);
      k.mesh.position.set(k.pos.x, k.pos.y + 0.24, k.pos.z);
      k.ring.visible = true;
    }

    for (const s of springs) {
      s.popTimer = 0;
      s.coilGroup.scale.y = 1;
    }

    if (bell) {
      bell.ringTimer = 0;
      bell.shakeTimer = 0;
      bell.pivot.rotation.z = 0;
    }

    for (const g of gates) {
      g.recoilTimer = 0;
      g.carriageGroup.position.x = 0.405;
      g.carriageGroup.rotation.y = 0;
      g.hubScaleY = 1;
      g.hubVelY = 0;
      g.hubGroup.scale.y = 1;
      g.barScaleY = 1;
      g.barVelY = 0;
      g.paddlePivot.scale.y = 1;
    }

    marbleHopTimer = 0;
    boostTrailDistAccum = 0;
    marbleMat.emissiveIntensity = 0;
    marble.visible = true;
    marble.position.set(startPos.x, startPos.y + MARBLE_RADIUS + 0.028, startPos.z);
    marble.quaternion.identity();

    contactShadow.visible = true;
    contactShadow.position.set(startPos.x, startPos.y + 0.028, startPos.z);
    contactShadow.scale.setScalar(1);
    contactShadowMat.opacity = 0.28;

    syncGates(startState, true);
  };

  const upAxis = new THREE.Vector3(0, 1, 0);
  const rollAxis = new THREE.Vector3();
  const deltaQuat = new THREE.Quaternion();

  const placeMarble = (
    pos: THREE.Vector3,
    tangent: THREE.Vector3,
    stepWorldDist: number,
    boostFrac = 0,
    reducedMotion = false
  ): void => {
    let hopLift = 0;
    if (marbleHopTimer > 0) {
      const frac = 1 - marbleHopTimer / SPRING_HOP_SEC;
      hopLift = Math.sin(frac * Math.PI) * SPRING_HOP_HEIGHT;
    }

    marble.position.set(pos.x, pos.y + MARBLE_RADIUS + 0.028 + hopLift, pos.z);
    contactShadow.position.set(pos.x, pos.y + 0.028, pos.z);
    const hopRatio = hopLift / SPRING_HOP_HEIGHT;
    contactShadow.scale.setScalar(1 - hopRatio * 0.36);
    contactShadowMat.opacity = 0.28 * (1 - hopRatio * 0.48);

    // Warm golden glow + trailing speed motes during spring speed boost
    const clampedBoost = THREE.MathUtils.clamp(boostFrac, 0, 1);
    marbleMat.emissiveIntensity = clampedBoost * 0.48;
    if (clampedBoost > 0.05 && !reducedMotion && stepWorldDist > 0) {
      boostTrailDistAccum += stepWorldDist;
      if (boostTrailDistAccum >= 0.16) {
        boostTrailDistAccum = 0;
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffe082,
          transparent: true,
          opacity: 0.85,
        });
        const mote = new THREE.Mesh(particleGeo, mat);
        mote.position.set(
          marble.position.x - tangent.x * 0.18 + (rng() - 0.5) * 0.08,
          marble.position.y - 0.06 + (rng() - 0.5) * 0.06,
          marble.position.z - tangent.z * 0.18 + (rng() - 0.5) * 0.08
        );
        mote.scale.setScalar(0.65);
        islandRoot.add(mote);
        particles.push({
          mesh: mote,
          vel: new THREE.Vector3(
            -tangent.x * 0.55 + (rng() - 0.5) * 0.45,
            0.45 + rng() * 0.45,
            -tangent.z * 0.55 + (rng() - 0.5) * 0.45
          ),
          life: 0,
          maxLife: 0.26 + rng() * 0.12,
        });
      }
    } else if (clampedBoost <= 0.05) {
      boostTrailDistAccum = 0;
    }

    if (stepWorldDist > 0) {
      rollAxis.crossVectors(upAxis, tangent);
      if (rollAxis.lengthSq() > 0.0001) {
        rollAxis.normalize();
        deltaQuat.setFromAxisAngle(rollAxis, stepWorldDist / MARBLE_RADIUS);
        marble.quaternion.premultiply(deltaQuat);
      }
    }
  };

  const updateAnimations = (dt: number, elapsed: number, reducedMotion: boolean): void => {
    if (marbleHopTimer > 0) {
      marbleHopTimer = Math.max(0, marbleHopTimer - dt);
    }

    // Gate orbiting 120ms elastic overshoot swing + physical gate-pass deflection recoil
    for (const gate of gates) {
      if (gate.swingElapsedMs < CLACK_SWING_MS) {
        gate.swingElapsedMs = Math.min(CLACK_SWING_MS, gate.swingElapsedMs + dt * 1000);
        const t = gate.swingElapsedMs / CLACK_SWING_MS;
        let eased: number;
        if (reducedMotion) {
          eased = t;
        } else {
          const c1 = 2.1;
          const c3 = c1 + 1;
          eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        }
        gate.paddlePivot.rotation.y = gate.fromAngle + (gate.targetAngle - gate.fromAngle) * eased;
      }

      if (gate.recoilTimer > 0) {
        gate.recoilTimer = Math.max(0, gate.recoilTimer - dt);
        const p = gate.recoilTimer / GATE_RECOIL_SEC;
        if (reducedMotion) {
          gate.carriageGroup.position.x = 0.405;
          gate.carriageGroup.rotation.y = 0;
        } else {
          // Crisp physical bump vibration on the outer T-bar as the marble deflects past it
          gate.carriageGroup.position.x = 0.405 + Math.sin(p * Math.PI) * 0.026 * p;
          gate.carriageGroup.rotation.y = Math.sin(p * Math.PI * 3.5) * 0.14 * p;
        }
      } else {
        gate.carriageGroup.position.x = 0.405;
        gate.carriageGroup.rotation.y = 0;
      }

      // Spring-loaded center hub plunger AND spring-loaded T-bar:
      // - Hub smoothly retracts flat whenever the marble rolls over the gate center (distXZ < 0.56).
      // - T-bar stays proud & solid when the marble takes the open side, but smoothly retracts flat
      //   ONLY when the marble is actually rolling/gliding directly over the T-bar (e.g. one-way entry
      //   from a shared side), then springs playfully back up once the marble clears it.
      let targetHubScale = 1;
      let targetBarScale = 1;
      if (marble.visible && Math.abs(marble.position.y - gate.group.position.y) < 0.65) {
        const dxCenter = marble.position.x - gate.group.position.x;
        const dzCenter = marble.position.z - gate.group.position.z;
        const distXZ = Math.hypot(dxCenter, dzCenter);
        if (distXZ < 0.56) {
          const t = THREE.MathUtils.clamp((distXZ - 0.26) / (0.56 - 0.26), 0, 1);
          const smooth = t * t * (3 - 2 * t);
          targetHubScale = THREE.MathUtils.lerp(0.11, 1, smooth);
        }

        // World XZ position & direction of the T-bar crossbar at local (+0.405, 0, 0)
        const yaw = gate.paddlePivot.rotation.y;
        const barDirX = Math.cos(yaw);
        const barDirZ = -Math.sin(yaw);
        const barX = gate.group.position.x + barDirX * 0.405;
        const barZ = gate.group.position.z + barDirZ * 0.405;
        const distToBar = Math.hypot(marble.position.x - barX, marble.position.z - barZ);
        // Only retract when the marble is actually on the T-bar's side rolling over it
        // (never when passing cleanly along the open perpendicular/opposite branch)
        const alongBarSide = dxCenter * barDirX + dzCenter * barDirZ;
        if (alongBarSide > 0.12 && distToBar < 0.48) {
          const tb = THREE.MathUtils.clamp((distToBar - 0.27) / (0.48 - 0.27), 0, 1);
          const smoothB = tb * tb * (3 - 2 * tb);
          targetBarScale = THREE.MathUtils.lerp(0.11, 1, smoothB);
        }
      }

      const stepPlungerSpring = (
        cur: number,
        vel: number,
        target: number
      ): readonly [number, number] => {
        if (reducedMotion) {
          return [target, 0];
        }
        if (target < cur) {
          return [cur + (target - cur) * Math.min(1, dt * 36), 0];
        }
        const stiffness = 280;
        const damping = 13.5;
        let nextVel = vel + (target - cur) * stiffness * dt;
        nextVel *= Math.exp(-damping * dt);
        const nextCur = THREE.MathUtils.clamp(cur + nextVel * dt, 0.1, 1.22);
        if (Math.abs(target - nextCur) < 0.002 && Math.abs(nextVel) < 0.01) {
          return [target, 0];
        }
        return [nextCur, nextVel];
      };

      const [nextHubScale, nextHubVel] = stepPlungerSpring(
        gate.hubScaleY,
        gate.hubVelY,
        targetHubScale
      );
      gate.hubScaleY = nextHubScale;
      gate.hubVelY = nextHubVel;
      gate.hubGroup.scale.y = gate.hubScaleY;

      const [nextBarScale, nextBarVel] = stepPlungerSpring(
        gate.barScaleY,
        gate.barVelY,
        targetBarScale
      );
      gate.barScaleY = nextBarScale;
      gate.barVelY = nextBarVel;
      gate.paddlePivot.scale.y = gate.barScaleY;
    }

    // Key idle bob & spin + pickup lift/fade
    for (const k of keys) {
      if (!k.collected) {
        if (!reducedMotion) {
          k.mesh.rotation.y += dt * 2.1;
          k.mesh.position.y = k.pos.y + 0.25 + Math.sin(elapsed * 3.0 + k.keyId * 2.0) * 0.055;
        }
      } else if (k.pickupAnim < 1) {
        k.pickupAnim = Math.min(1, k.pickupAnim + dt * 3.8);
        k.mesh.position.y = k.pos.y + 0.25 + k.pickupAnim * 0.72;
        k.mesh.rotation.y += dt * 9.0;
        k.mesh.scale.setScalar(Math.max(0.001, 1 - k.pickupAnim));
        if (k.pickupAnim >= 1) k.mesh.visible = false;
      }
    }

    // Spring recoil animation
    for (const s of springs) {
      if (s.popTimer > 0) {
        s.popTimer = Math.max(0, s.popTimer - dt);
        const p = s.popTimer / 0.35;
        const stretch = reducedMotion ? 1 : 1 + Math.sin(p * Math.PI * 3) * 0.42 * p;
        s.coilGroup.scale.y = Math.max(0.45, stretch);
      } else {
        s.coilGroup.scale.y = 1;
      }
    }

    // Bell swing / locked shake animation
    if (bell) {
      if (bell.ringTimer > 0) {
        bell.ringTimer = Math.max(0, bell.ringTimer - dt);
        const p = bell.ringTimer / 1.4;
        bell.pivot.rotation.z = reducedMotion ? 0 : Math.sin(p * Math.PI * 9) * 0.42 * p;
      } else if (bell.shakeTimer > 0) {
        bell.shakeTimer = Math.max(0, bell.shakeTimer - dt);
        const p = bell.shakeTimer / 0.42;
        bell.pivot.rotation.z = reducedMotion ? 0 : Math.sin(p * Math.PI * 6) * 0.22 * p;
      } else {
        bell.pivot.rotation.z = 0;
      }
    }

    // Update golden burst particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      if (!pt) continue;
      pt.life += dt;
      pt.vel.y -= 6.5 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      pt.mesh.rotation.x += dt * 5;
      pt.mesh.rotation.y += dt * 4;
      const frac = pt.life / pt.maxLife;
      pt.mesh.material.opacity = Math.max(0, 1 - frac);
      pt.mesh.scale.setScalar(Math.max(0.01, 1 - frac * 0.7));
      if (pt.life >= pt.maxLife) {
        islandRoot.remove(pt.mesh);
        pt.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }
  };

  const disposeParticles = (): void => {
    for (const pt of particles) {
      islandRoot.remove(pt.mesh);
      pt.mesh.material.dispose();
    }
    particles.length = 0;
    particleGeo.dispose();
  };

  syncGates(level.startState, true);

  return {
    marble,
    contactShadow,
    gates,
    keys,
    springs,
    bell,
    textures,
    syncGates,
    triggerGatePass,
    triggerKeyPickup,
    triggerSpringPop,
    triggerBellRing,
    triggerBellLocked,
    resetVisuals,
    placeMarble,
    updateAnimations,
    disposeParticles,
  };
}
