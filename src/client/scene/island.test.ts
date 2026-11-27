import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ISLANDS } from '../../shared/levels';
import { disposeObjectTree } from './dispose';
import { buildIslandDiorama } from './index';
import { buildIslandBase, HALF_DECK } from './island';
import { buildPieces, MARBLE_RADIUS } from './pieces';
import { createPRNG } from './prng';
import { buildTrackSystem } from './tracks';

describe('Island underside, pointed spires, satellite islets, and disposal', () => {
  it('keeps main pointed cliff and all fused crags strictly inset inside rounded deck/plinth footprint across all 5 islands', () => {
    const cliffFingerprints = new Set<string>();

    for (const island of ISLANDS) {
      const root = new THREE.Group();
      buildIslandBase(root, island, createPRNG(island.seed));

      const rockMeshes: THREE.Mesh[] = [];
      root.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh &&
          (obj.name === 'island-cliff' || obj.name === 'island-crag') &&
          obj.geometry instanceof THREE.BufferGeometry
        ) {
          rockMeshes.push(obj);
        }
      });

      // 1 main edge-hugging pointed cliff + 4 medium-slender pointed edge crags
      expect(rockMeshes).toHaveLength(5);

      // Lower plinth rim outer edge is 4.395 with rounded corner radius 0.755
      const plinthOuterHalf = HALF_DECK + 0.14 + 0.055;
      const plinthOuterCornerR = 0.56 + 0.14 + 0.055;
      const maxAllowedCoord = plinthOuterHalf - 0.18;
      const maxAllowedCornerDist =
        (plinthOuterHalf - plinthOuterCornerR) * Math.SQRT2 + plinthOuterCornerR - 0.18;

      const worldPos = new THREE.Vector3();
      const firstMainGeo = rockMeshes[0]?.geometry;
      if (firstMainGeo instanceof THREE.BufferGeometry) {
        const p = firstMainGeo.getAttribute('position');
        if (p) {
          const sig: string[] = [];
          for (let i = 0; i < Math.min(24, p.count); i++) {
            sig.push(`${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`);
          }
          cliffFingerprints.add(sig.join('|'));
        }
      }

      for (let mIdx = 0; mIdx < rockMeshes.length; mIdx++) {
        const mesh = rockMeshes[mIdx];
        if (!mesh || !(mesh.geometry instanceof THREE.BufferGeometry)) continue;
        mesh.updateMatrixWorld(true);

        const pos = mesh.geometry.getAttribute('position');
        const norm = mesh.geometry.getAttribute('normal');
        expect(pos).toBeDefined();
        expect(norm).toBeDefined();
        if (!pos || !norm) continue;

        let minY = 0;
        for (let i = 0; i < pos.count; i++) {
          worldPos.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
          minY = Math.min(minY, worldPos.y);

          expect(Math.abs(worldPos.x)).toBeLessThanOrEqual(maxAllowedCoord);
          expect(Math.abs(worldPos.z)).toBeLessThanOrEqual(maxAllowedCoord);
          expect(Math.hypot(worldPos.x, worldPos.z)).toBeLessThanOrEqual(maxAllowedCornerDist);

          if (mIdx === 0 && worldPos.y > -3.9) {
            const radialDot = worldPos.x * norm.getX(i) + worldPos.z * norm.getZ(i);
            expect(radialDot).toBeGreaterThan(-0.12);
          }
        }

        if (mIdx === 0) {
          expect(minY).toBeLessThan(-4.35);
          expect(minY).toBeGreaterThan(-4.9);
        }
      }

      disposeObjectTree(root);
    }

    expect(cliffFingerprints.size).toBe(ISLANDS.length);
  });

  it('aligns every satellite stone underside cleanly inside its cap as a watertight manifold with outward normals', () => {
    const keyVert = (x: number, y: number, z: number): string =>
      `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;

    for (const island of ISLANDS) {
      const root = new THREE.Group();
      const { satellites } = buildIslandBase(root, island, createPRNG(island.seed));
      expect(satellites).toHaveLength(4);

      for (const sat of satellites) {
        const cap = sat.group.children[0];
        const stone = sat.group.children[1];
        expect(cap).toBeInstanceOf(THREE.Mesh);
        expect(stone).toBeInstanceOf(THREE.Mesh);
        if (!(cap instanceof THREE.Mesh) || !(stone instanceof THREE.Mesh)) continue;
        expect(stone.name).toBe('satellite-stone');

        expect(cap.rotation.x).toBe(0);
        expect(stone.rotation.x).toBe(0);
        expect(cap.rotation.y).toBe(stone.rotation.y);

        const capBox = new THREE.Box3().setFromObject(cap);
        const stoneBox = new THREE.Box3().setFromObject(stone);
        expect(stoneBox.max.y).toBeGreaterThan(capBox.min.y);

        const stonePos = stone.geometry.getAttribute('position');
        const stoneNorm = stone.geometry.getAttribute('normal');
        const capPos = cap.geometry.getAttribute('position');
        expect(stonePos).toBeDefined();
        expect(stoneNorm).toBeDefined();
        if (stonePos && stoneNorm && capPos) {
          let maxCapR = 0;
          for (let i = 0; i < capPos.count; i++) {
            maxCapR = Math.max(maxCapR, Math.hypot(capPos.getX(i), capPos.getZ(i)));
          }
          let maxStoneR = 0;
          for (let i = 0; i < stonePos.count; i++) {
            maxStoneR = Math.max(maxStoneR, Math.hypot(stonePos.getX(i), stonePos.getZ(i)));
          }
          expect(maxStoneR).toBeLessThan(maxCapR * 0.92);

          // Watertight closed-manifold check: every directed half-edge (A->B) has exactly one opposite (B->A)
          const halfEdges = new Map<string, number>();
          expect(stonePos.count % 3).toBe(0);
          for (let i = 0; i < stonePos.count; i += 3) {
            const v0 = keyVert(stonePos.getX(i), stonePos.getY(i), stonePos.getZ(i));
            const v1 = keyVert(stonePos.getX(i + 1), stonePos.getY(i + 1), stonePos.getZ(i + 1));
            const v2 = keyVert(stonePos.getX(i + 2), stonePos.getY(i + 2), stonePos.getZ(i + 2));
            for (const [a, b] of [
              [v0, v1],
              [v1, v2],
              [v2, v0],
            ] as const) {
              const e = `${a}->${b}`;
              halfEdges.set(e, (halfEdges.get(e) ?? 0) + 1);
            }

            // Outward normal check: vector from centroid of stone (0, -0.35, 0) to face center aligns with face normal
            const cx = (stonePos.getX(i) + stonePos.getX(i + 1) + stonePos.getX(i + 2)) / 3;
            const cy = (stonePos.getY(i) + stonePos.getY(i + 1) + stonePos.getY(i + 2)) / 3;
            const cz = (stonePos.getZ(i) + stonePos.getZ(i + 1) + stonePos.getZ(i + 2)) / 3;
            const nx = stoneNorm.getX(i);
            const ny = stoneNorm.getY(i);
            const nz = stoneNorm.getZ(i);
            const outDot = cx * nx + (cy + 0.35) * ny + cz * nz;
            expect(outDot).toBeGreaterThan(0);
          }

          for (const [edgeKey, count] of halfEdges) {
            expect(count).toBe(1);
            const [a, b] = edgeKey.split('->');
            expect(halfEdges.get(`${b}->${a}`)).toBe(1);
          }
        }
      }

      disposeObjectTree(root);
    }
  });

  it('unifies ground and bridge tracks with pure uniform sunlit rails and cross-beams across all 5 islands', () => {
    for (const island of ISLANDS) {
      const root = new THREE.Group();
      const tracks = buildTrackSystem(root, island);

      // Verify precomputed integer lengthSim stays tightly synced with 3D spline world length
      for (const seg of tracks.segmentsById.values()) {
        expect(Math.abs(seg.lengthWorld * 1000 - seg.edge.lengthSim)).toBeLessThanOrEqual(2);
      }

      const railMaterials = new Set<THREE.Material>();
      const crossBeamGeos = new Set<THREE.BufferGeometry>();
      const crossBeams: THREE.Mesh[] = [];
      let instancedCount = 0;
      let shapeGeoCount = 0;
      let ribbonMeshCount = 0;

      root.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) {
          instancedCount += 1;
        }
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry instanceof THREE.ShapeGeometry) {
            shapeGeoCount += 1;
          }
          if (obj.name === 'track-rail' && obj.material instanceof THREE.Material) {
            railMaterials.add(obj.material);
          }
          if (obj.name === 'track-crossbeam') {
            crossBeams.push(obj);
            if (obj.geometry instanceof THREE.BufferGeometry) {
              crossBeamGeos.add(obj.geometry);
            }
          }
          if (
            !(obj.geometry instanceof THREE.TubeGeometry) &&
            !(obj.geometry instanceof THREE.BoxGeometry)
          ) {
            ribbonMeshCount += 1;
          }
        }
      });

      // Zero chevrons, zero InstancedMesh dark ties, zero flat glowing gate-inlay ribbons
      expect(shapeGeoCount).toBe(0);
      expect(instancedCount).toBe(0);
      expect(ribbonMeshCount).toBe(0);

      // Single shared railMat across ALL rails and cross-beams, single shared BoxGeometry across all cross-beams
      expect(railMaterials.size).toBe(1);
      expect(crossBeamGeos.size).toBe(1);
      expect(crossBeams.length).toBeGreaterThanOrEqual(16);

      for (const beam of crossBeams) {
        if (beam.material instanceof THREE.Material) {
          expect(railMaterials.has(beam.material)).toBe(true);
        }
        beam.updateMatrix();
        // Positive-determinant right-handed transform guarantees zero inverted/dark normals
        expect(beam.matrix.determinant()).toBeCloseTo(1, 5);
        expect(beam.scale.x).toBe(1);
        expect(beam.scale.y).toBe(1);
        expect(beam.scale.z).toBe(1);

        // Generous clearance around gates, trapdoors, bell, and start cradle
        for (const node of Object.values(island.nodes)) {
          if (node.type === 'merge') continue;
          const nodePos = new THREE.Vector3(node.pos.x, node.pos.y, node.pos.z);
          expect(beam.position.distanceTo(nodePos)).toBeGreaterThanOrEqual(0.5);
        }
      }

      // Verify no track rail tube vertex pokes inside any trapdoor's dark circular pit
      const trapdoors = Object.values(island.nodes).filter((n) => n.type === 'trapdoor');
      root.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh &&
          obj.name === 'track-rail' &&
          obj.geometry instanceof THREE.BufferGeometry
        ) {
          const posAttr = obj.geometry.getAttribute('position');
          if (!posAttr) return;
          for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i);
            const vz = posAttr.getZ(i);
            for (const trap of trapdoors) {
              const distXZ = Math.hypot(vx - trap.pos.x, vz - trap.pos.z);
              expect(distXZ).toBeGreaterThan(0.32);
            }
          }
        }
      });

      // Verify every trapdoor hole sits cleanly inside the deck footprint with generous edge margin
      // and never collides with the bell pad / archway
      const bellNode = island.nodes['bell'];
      for (const trap of trapdoors) {
        expect(Math.abs(trap.pos.x) + 0.38).toBeLessThan(HALF_DECK - 0.15);
        expect(Math.abs(trap.pos.z) + 0.38).toBeLessThan(HALF_DECK - 0.15);
        if (bellNode) {
          const bellTrapDist = Math.hypot(
            trap.pos.x - bellNode.pos.x,
            trap.pos.z - bellNode.pos.z
          );
          expect(bellTrapDist).toBeGreaterThanOrEqual(1.2);
        }
      }

      disposeObjectTree(root);
    }
  }, 15000);

  it('stands 3D gate hubs proud at rest, retracts them flat under the marble, springs them back up, and animates T-bar recoil & spring hop', () => {
    const tmpBox = new THREE.Box3();
    for (const island of ISLANDS) {
      const root = new THREE.Group();
      const tracks = buildTrackSystem(root, island);
      const pieces = buildPieces(root, island, tracks, createPRNG(island.seed));
      const startNode = island.nodes['start'];
      if (startNode) {
        pieces.resetVisuals(startNode.pos, island.startState);
      }
      root.updateMatrixWorld(true);

      expect(pieces.gates.length).toBeGreaterThanOrEqual(3);
      for (const gate of pieces.gates) {
        // Proud 3D wooden hub + biome enamel cap at rest (top >= 0.22)
        tmpBox.setFromObject(gate.hubGroup);
        expect(tmpBox.max.y).toBeGreaterThanOrEqual(gate.group.position.y + 0.22);

        // Orbiting outer T-bar carriage sits cleanly on the outer brass ring (r >= 0.39)
        expect(gate.carriageGroup.position.x).toBeGreaterThanOrEqual(0.39);
      }

      const firstGate = pieces.gates[0];
      if (firstGate) {
        // Verify T-bar stem connects cleanly from the center hub to the outer bumper bar
        const stem = firstGate.paddlePivot.getObjectByName('gate-tbar-stem');
        expect(stem).toBeInstanceOf(THREE.Mesh);

        // Rolling marble onto gate center (NOT over the T-bar) compresses hub flat while T-bar stays proud
        pieces.placeMarble(
          firstGate.group.position.clone(),
          new THREE.Vector3(1, 0, 0),
          0.1
        );
        for (let i = 0; i < 6; i++) {
          pieces.updateAnimations(0.03, i * 0.03, false);
        }
        expect(firstGate.hubGroup.scale.y).toBeLessThan(0.18);
        expect(firstGate.paddlePivot.scale.y).toBeGreaterThan(0.95);

        // Rolling marble directly OVER the T-bar crossbar compresses the T-bar flat too
        const yaw = firstGate.paddlePivot.rotation.y;
        const barWorldPos = new THREE.Vector3(
          firstGate.group.position.x + Math.cos(yaw) * 0.405,
          firstGate.group.position.y,
          firstGate.group.position.z - Math.sin(yaw) * 0.405
        );
        pieces.placeMarble(barWorldPos, new THREE.Vector3(1, 0, 0), 0.1);
        for (let i = 0; i < 6; i++) {
          pieces.updateAnimations(0.03, i * 0.03, false);
        }
        expect(firstGate.paddlePivot.scale.y).toBeLessThan(0.18);

        // Moving marble away lets BOTH the hub and T-bar spring back up cleanly
        pieces.placeMarble(new THREE.Vector3(9, 0, 9), new THREE.Vector3(1, 0, 0), 0.1);
        for (let i = 0; i < 20; i++) {
          pieces.updateAnimations(0.025, i * 0.025, false);
        }
        expect(firstGate.hubGroup.scale.y).toBeGreaterThan(0.92);
        expect(firstGate.paddlePivot.scale.y).toBeGreaterThan(0.92);

        // Gate-pass recoil physically vibrates the orbiting T-bar carriage
        pieces.triggerGatePass(firstGate.id);
        pieces.updateAnimations(0.05, 0.05, false);
        expect(firstGate.carriageGroup.position.x).toBeGreaterThan(0.405);
      }

      // Verify sculpted brass Start direction pointer exists on every island
      const startPointer = root.getObjectByName('start-direction-pointer');
      expect(startPointer).toBeInstanceOf(THREE.Group);

      // Spring hop lifts marble cleanly above track while shrinking its grounded contact shadow,
      // and spring boost gives the marble a warm golden glow
      const firstSpring = pieces.springs[0];
      if (firstSpring) {
        pieces.triggerSpringPop(firstSpring.springId, false);
        pieces.updateAnimations(0.12, 0.12, false);
        pieces.placeMarble(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 0.2, 0.85, false);
        expect(pieces.marble.position.y).toBeGreaterThan(MARBLE_RADIUS + 0.15);
        expect(pieces.contactShadow.position.y).toBeCloseTo(0.028, 3);
        expect(pieces.contactShadow.scale.x).toBeLessThan(0.85);
        if (pieces.marble.material instanceof THREE.MeshStandardMaterial) {
          expect(pieces.marble.material.emissiveIntensity).toBeGreaterThan(0.3);
        }
      }

      pieces.disposeParticles();
      disposeObjectTree(root, pieces.textures);
    }
  });

  it('pools biome prop & piece materials tightly per island and disposes 100% cleanly across all 5 islands', () => {
    const scene = new THREE.Scene();

    for (const island of ISLANDS) {
      const diorama = buildIslandDiorama(scene, island);
      const root = diorama.root;

      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry instanceof THREE.BufferGeometry) {
            geos.add(obj.geometry);
          }
          if (Array.isArray(obj.material)) {
            for (const m of obj.material) {
              if (m instanceof THREE.Material) mats.add(m);
            }
          } else if (obj.material instanceof THREE.Material) {
            mats.add(obj.material);
          }
        }
      });

      // Shared per-island material pool keeps unique materials compact across all props, islets, tracks, and pieces
      expect(mats.size).toBeLessThanOrEqual(45);

      let disposedGeos = 0;
      let disposedMats = 0;
      for (const g of geos) {
        const orig = g.dispose.bind(g);
        g.dispose = () => {
          disposedGeos += 1;
          orig();
        };
      }
      for (const m of mats) {
        const orig = m.dispose.bind(m);
        m.dispose = () => {
          disposedMats += 1;
          orig();
        };
      }

      diorama.dispose();

      expect(disposedGeos).toBe(geos.size);
      expect(disposedMats).toBe(mats.size);
      expect(scene.children).toHaveLength(0);
    }
  });

  it('disposes shared material maps and instance resources exactly once', () => {
    const texture = new THREE.Texture();
    const geometry = new THREE.BoxGeometry();
    const first = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture });
    const second = new THREE.MeshBasicMaterial({ map: texture });
    const instance = new THREE.InstancedMesh(geometry, [first, second], 2);
    const calls = { texture: 0, geometry: 0, first: 0, second: 0, instance: 0 };
    texture.addEventListener('dispose', () => calls.texture++);
    geometry.addEventListener('dispose', () => calls.geometry++);
    first.addEventListener('dispose', () => calls.first++);
    second.addEventListener('dispose', () => calls.second++);
    instance.addEventListener('dispose', () => calls.instance++);
    const root = new THREE.Group().add(instance, new THREE.Mesh(geometry, first));

    disposeObjectTree(root, [texture, texture], [first]);

    expect(calls).toEqual({ texture: 1, geometry: 1, first: 1, second: 1, instance: 1 });
  });

  it('disposes every geometry, material and texture across 20 consecutive island swaps', () => {
    const scene = new THREE.Scene();
    const baselineChildren = scene.children.length;

    for (let swap = 0; swap < 20; swap++) {
      const island = ISLANDS[swap % ISLANDS.length];
      if (!island) throw new Error('missing island');
      const diorama = buildIslandDiorama(scene, island);

      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      diorama.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry instanceof THREE.BufferGeometry) geometries.add(obj.geometry);
          const list: unknown[] = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of list) {
            if (m instanceof THREE.Material) materials.add(m);
          }
        }
      });
      expect(geometries.size).toBeGreaterThan(0);

      const disposalCounts = new Map<object, number>();
      const record = (resource: object): void => {
        disposalCounts.set(resource, (disposalCounts.get(resource) ?? 0) + 1);
      };
      for (const g of geometries) g.addEventListener('dispose', () => record(g));
      for (const m of materials) m.addEventListener('dispose', () => record(m));
      for (const t of diorama.pieces.textures) t.addEventListener('dispose', () => record(t));

      diorama.dispose();
      diorama.dispose();

      for (const g of geometries) expect(disposalCounts.get(g)).toBe(1);
      for (const m of materials) expect(disposalCounts.get(m)).toBe(1);
      for (const t of diorama.pieces.textures) expect(disposalCounts.get(t)).toBe(1);
      expect(scene.children.length).toBe(baselineChildren);
    }
  }, 30_000);
});
