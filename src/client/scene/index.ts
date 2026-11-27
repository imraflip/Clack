import * as THREE from 'three';
import type { LevelDef } from '../../shared/levels';
import { animateWaterwheel, createPropMaterialPool, populateBiomeProps } from './biomes';
import type { WaterwheelVisual } from './biomes';
import { disposeObjectTree } from './dispose';
import { animateSatellites, buildIslandBase } from './island';
import type { SatelliteVisual } from './island';
import { buildPieces } from './pieces';
import type { PiecesBundle } from './pieces';
import { createPRNG } from './prng';
import { buildTrackSystem } from './tracks';
import type { TrackSystem } from './tracks';

export { createCameraController } from './camera';
export type { CameraController } from './camera';
export { createStage } from './stage';
export type { QualityTier, StageController } from './stage';

export type IslandDiorama = {
  readonly root: THREE.Group;
  readonly tracks: TrackSystem;
  readonly pieces: PiecesBundle;
  readonly satellites: readonly SatelliteVisual[];
  readonly waterwheel: WaterwheelVisual | null;
  readonly updateAmbient: (dt: number, elapsed: number, reducedMotion: boolean) => void;
  readonly dispose: () => void;
};

export function buildIslandDiorama(scene: THREE.Scene, level: LevelDef): IslandDiorama {
  const rng = createPRNG(level.seed);
  const materialPool = createPropMaterialPool();
  const root = new THREE.Group();
  scene.add(root);

  const { satellites } = buildIslandBase(root, level, rng, materialPool);
  const tracks = buildTrackSystem(root, level);
  const { waterwheel } = populateBiomeProps(root, level.props, rng, materialPool);
  const pieces = buildPieces(root, level, tracks, rng, materialPool);

  const updateAmbient = (dt: number, elapsed: number, reducedMotion: boolean): void => {
    animateSatellites(satellites, elapsed, reducedMotion);
    animateWaterwheel(waterwheel, elapsed, dt, reducedMotion);
    pieces.updateAnimations(dt, elapsed, reducedMotion);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    pieces.disposeParticles();
    scene.remove(root);
    disposeObjectTree(root, pieces.textures);
  };

  return {
    root,
    tracks,
    pieces,
    satellites,
    waterwheel,
    updateAmbient,
    dispose,
  };
}
