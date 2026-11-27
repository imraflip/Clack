import * as THREE from 'three';
import type { LevelDef, LevelEdge } from '../../shared/levels';

export const GROOVE_WIDTH = 0.56;
export const RAIL_OFFSET = 0.285;
export const RAIL_RADIUS = 0.048;

// Unified cross-beam dimensions shared by all ground and elevated bridge tracks
export const CROSSBEAM_SPACING = 0.6;
export const CROSSBEAM_WIDTH = RAIL_OFFSET * 2; // 0.57 — trimmed cleanly center-to-center inside twin rails (zero overhang)
export const CROSSBEAM_HEIGHT = 0.044;
export const CROSSBEAM_DEPTH = 0.1;
const CROSSBEAM_Y_OFFSET = 0.026; // Sits in lower half of the 0.096-tall rails, resting cleanly above the deck (+0.004)

export type TrackSample = {
  readonly position: THREE.Vector3;
  readonly tangent: THREE.Vector3;
};

export type CompiledSegment = {
  readonly edge: LevelEdge;
  readonly curve: THREE.CatmullRomCurve3;
  readonly lengthWorld: number;
};

export type TrackSystem = {
  readonly segmentsById: ReadonlyMap<string, CompiledSegment>;
  readonly outgoingByNode: ReadonlyMap<string, readonly CompiledSegment[]>;
  readonly positionAt: (segmentId: string, simDistance: number) => TrackSample;
};

type ExclusionZone = {
  readonly pos: THREE.Vector3;
  readonly radiusSq: number;
};

function buildOffsetRailCurve(
  curve: THREE.CatmullRomCurve3,
  sideSign: number,
  offsetDist: number,
  yLift: number,
  samples: number,
  uEnd = 1
): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= samples; i++) {
    const u = (i / samples) * uEnd;
    const pt = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const right = new THREE.Vector3().crossVectors(tan, up);
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    right.normalize();
    const p = pt.clone().addScaledVector(right, sideSign * offsetDist);
    p.y += yLift;
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function collectNodeExclusionZones(level: LevelDef): ExclusionZone[] {
  const zones: ExclusionZone[] = [];
  for (const node of Object.values(level.nodes)) {
    let r = 0.38; // merge junction clearance
    if (node.type === 'gate') r = 0.54; // clears 0.432 brass ring + 0.05 beam half-depth + margin
    else if (node.type === 'trapdoor') r = 0.54; // clears 0.438 rim + 0.05 beam half-depth + margin
    else if (node.type === 'bell') r = 0.66;
    else if (node.type === 'start') r = 0.54;

    zones.push({
      pos: new THREE.Vector3(node.pos.x, node.pos.y, node.pos.z),
      radiusSq: r * r,
    });
  }
  return zones;
}

/**
 * Computes a guaranteed right-handed (determinant = +1) orientation quaternion
 * with local +X across the rails, local +Y along the track slope normal, and local -Z forward along tangent.
 */
function computeCrossBeamFrame(
  tan: THREE.Vector3,
  worldUp: THREE.Vector3,
  outNormal: THREE.Vector3,
  outQuat: THREE.Quaternion
): void {
  const right = new THREE.Vector3().crossVectors(tan, worldUp);
  if (right.lengthSq() < 0.0001) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }
  outNormal.crossVectors(right, tan).normalize();
  // right × outNormal = -tan, so (right, outNormal, -tan) is strictly right-handed (det = +1)
  const back = tan.clone().negate();
  const rotMat = new THREE.Matrix4().makeBasis(right, outNormal, back);
  outQuat.setFromRotationMatrix(rotMat);
}

export function buildTrackSystem(islandRoot: THREE.Group, level: LevelDef): TrackSystem {
  const pal = level.palette;

  // Single shared wooden rail material used by ALL twin guide rails, ALL cross-beams
  // (ground and bridge alike), and elevated bridge handrails/stanchions.
  const railMat = new THREE.MeshStandardMaterial({
    color: pal.rail,
    roughness: 0.68,
    metalness: 0.05,
  });

  // Single shared cross-beam geometry reused across every ground and bridge track segment
  const crossBeamGeo = new THREE.BoxGeometry(CROSSBEAM_WIDTH, CROSSBEAM_HEIGHT, CROSSBEAM_DEPTH);

  const segmentsById = new Map<string, CompiledSegment>();
  const outgoingMutable = new Map<string, CompiledSegment[]>();

  const exclusionZones = collectNodeExclusionZones(level);
  const compiledList: CompiledSegment[] = [];

  for (const edgeDef of level.edges) {
    const controlPts = edgeDef.pts.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(controlPts, false, 'centripetal', 0.45);
    const lengthWorld = curve.getLength();
    const segs = Math.max(24, Math.round(lengthWorld * 10));

    // Register track item exclusion zones (keys & springs) so cross-beams never clip items
    for (const item of edgeDef.items) {
      const itemPt = curve.getPointAt(item.u);
      const itemRadius = item.type === 'spring' ? 0.42 : 0.38;
      exclusionZones.push({
        pos: itemPt,
        radiusSq: itemRadius * itemRadius,
      });
    }

    // Twin continuous rounded wooden side guide rails (trimmed cleanly at trapdoor rim so rails never poke inside the pit)
    const endsAtTrapdoor = level.nodes[edgeDef.to]?.type === 'trapdoor';
    const railUEnd = endsAtTrapdoor
      ? Math.max(0.15, 1 - 0.37 / Math.max(0.5, lengthWorld))
      : 1;

    for (const side of [-1, 1] as const) {
      const railCurve = buildOffsetRailCurve(curve, side, RAIL_OFFSET, 0.048, segs, railUEnd);
      const railGeo = new THREE.TubeGeometry(railCurve, segs, RAIL_RADIUS, 8, false);
      const railMesh = new THREE.Mesh(railGeo, railMat);
      railMesh.name = 'track-rail';
      railMesh.castShadow = true;
      railMesh.receiveShadow = true;
      islandRoot.add(railMesh);
    }

    // Elevated bridge-only vertical support legs, stanchions, and top handrails
    // (Horizontal cross-beams are built uniformly for BOTH ground and bridge tracks below)
    if (edgeDef.bridge) {
      const postMat = new THREE.MeshStandardMaterial({
        color: pal.bevel,
        roughness: 0.82,
        flatShading: true,
      });

      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const pt = curve.getPointAt(u);
        if (pt.y > 0.22 && i % 6 === 0) {
          const tan = curve.getTangentAt(u).normalize();
          const right = new THREE.Vector3()
            .crossVectors(tan, new THREE.Vector3(0, 1, 0))
            .normalize();
          for (const side of [-1, 1] as const) {
            const basePt = pt.clone().addScaledVector(right, side * 0.3);
            const postH = pt.y + 0.02;
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, postH, 0.08), postMat);
            post.name = 'bridge-post';
            post.position.set(basePt.x, postH * 0.5, basePt.z);
            post.castShadow = true;
            post.receiveShadow = true;
            islandRoot.add(post);

            const stanchion = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.22, 0.055), railMat);
            stanchion.name = 'bridge-stanchion';
            stanchion.position.set(basePt.x, pt.y + 0.14, basePt.z);
            stanchion.castShadow = true;
            islandRoot.add(stanchion);
          }
        }
      }

      // Top handrails along elevated stretch
      const elevatedSamplesL: THREE.Vector3[] = [];
      const elevatedSamplesR: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const pt = curve.getPointAt(u);
        if (pt.y > 0.16) {
          const tan = curve.getTangentAt(u).normalize();
          const right = new THREE.Vector3()
            .crossVectors(tan, new THREE.Vector3(0, 1, 0))
            .normalize();
          elevatedSamplesL.push(
            pt.clone().addScaledVector(right, -0.3).add(new THREE.Vector3(0, 0.24, 0))
          );
          elevatedSamplesR.push(
            pt.clone().addScaledVector(right, 0.3).add(new THREE.Vector3(0, 0.24, 0))
          );
        }
      }
      for (const pts of [elevatedSamplesL, elevatedSamplesR]) {
        if (pts.length >= 2) {
          const c = new THREE.CatmullRomCurve3(pts);
          const rail = new THREE.Mesh(new THREE.TubeGeometry(c, 22, 0.03, 6, false), railMat);
          rail.name = 'bridge-handrail';
          rail.castShadow = true;
          islandRoot.add(rail);
        }
      }
    }

    const compiled: CompiledSegment = {
      edge: edgeDef,
      curve,
      lengthWorld,
    };
    compiledList.push(compiled);
    segmentsById.set(edgeDef.id, compiled);

    const list = outgoingMutable.get(edgeDef.from);
    if (list) {
      list.push(compiled);
    } else {
      outgoingMutable.set(edgeDef.from, [compiled]);
    }
  }

  // Unified horizontal cross-beams for ALL ground and elevated bridge tracks
  // Uses exact same railMat, shared crossBeamGeo, and guaranteed positive-determinant quaternion orientation.
  const placedPositions: THREE.Vector3[] = [];
  const minBeamSeparationSq = 0.36 * 0.36;
  const worldUp = new THREE.Vector3(0, 1, 0);
  const slopeNormal = new THREE.Vector3();
  const beamQuat = new THREE.Quaternion();
  let placedAnyBeam = false;

  const tryPlaceBeam = (seg: CompiledSegment, u: number): boolean => {
    const pt = seg.curve.getPointAt(u);

    // Skip cross-beams inside gates, trapdoors, bell, start cradle, merges, keys, and springs
    for (const zone of exclusionZones) {
      if (pt.distanceToSquared(zone.pos) < zone.radiusSq) {
        return false;
      }
    }

    // Prevent stacking at tight track merges or crossings (3D distance preserves bridge-over-ground)
    for (const prev of placedPositions) {
      if (pt.distanceToSquared(prev) < minBeamSeparationSq) {
        return false;
      }
    }

    const tan = seg.curve.getTangentAt(u).normalize();
    computeCrossBeamFrame(tan, worldUp, slopeNormal, beamQuat);

    const beam = new THREE.Mesh(crossBeamGeo, railMat);
    beam.name = 'track-crossbeam';
    beam.position.set(
      pt.x + slopeNormal.x * CROSSBEAM_Y_OFFSET,
      pt.y + slopeNormal.y * CROSSBEAM_Y_OFFSET,
      pt.z + slopeNormal.z * CROSSBEAM_Y_OFFSET
    );
    beam.quaternion.copy(beamQuat);
    beam.scale.set(1, 1, 1);
    beam.castShadow = true;
    beam.receiveShadow = true;
    islandRoot.add(beam);

    placedPositions.push(pt);
    placedAnyBeam = true;
    return true;
  };

  for (const seg of compiledList) {
    const beamCount = Math.max(1, Math.floor(seg.lengthWorld / CROSSBEAM_SPACING));
    let placedInSegment = 0;

    for (let i = 0; i < beamCount; i++) {
      const u = (i + 0.5) / beamCount;
      if (tryPlaceBeam(seg, u)) {
        placedInSegment += 1;
      }
    }

    // For short gate outgoing branches where regular spacing fell inside exclusion zones,
    // attempt one centered beam at u = 0.5 if space permits
    if (placedInSegment === 0 && (seg.edge.branch === 'A' || seg.edge.branch === 'B')) {
      tryPlaceBeam(seg, 0.5);
    }
  }

  if (!placedAnyBeam) {
    crossBeamGeo.dispose();
  }

  const positionAt = (segmentId: string, simDistance: number): TrackSample => {
    const seg = segmentsById.get(segmentId);
    if (!seg) {
      throw new Error(`Unknown track segment "${segmentId}"`);
    }
    const u = THREE.MathUtils.clamp(simDistance / Math.max(1, seg.edge.lengthSim), 0, 1);
    return {
      position: seg.curve.getPointAt(u),
      tangent: seg.curve.getTangentAt(u).normalize(),
    };
  };

  return {
    segmentsById,
    outgoingByNode: outgoingMutable,
    positionAt,
  };
}
