import * as THREE from 'three';

export type CameraController = {
  readonly camera: THREE.PerspectiveCamera;
  readonly resize: (width: number, height: number) => void;
  readonly setHoverNormalized: (nx: number, ny: number) => void;
  readonly clearHover: () => void;
  readonly applyDragDelta: (dx: number, dy: number) => void;
  readonly recenter: () => void;
  readonly update: (dt: number, reducedMotion: boolean) => void;
};

export function createCameraController(width: number, height: number): CameraController {
  const camera = new THREE.PerspectiveCamera(34, width / Math.max(1, height), 0.1, 120);

  const baseElev = THREE.MathUtils.degToRad(42);
  const baseAzim = THREE.MathUtils.degToRad(0);
  const minTiltYaw = THREE.MathUtils.degToRad(-28);
  const maxTiltYaw = THREE.MathUtils.degToRad(28);
  const minTiltPitch = THREE.MathUtils.degToRad(-14);
  const maxTiltPitch = THREE.MathUtils.degToRad(14);
  const minElev = THREE.MathUtils.degToRad(24);
  const maxElev = THREE.MathUtils.degToRad(62);
  const maxHoverYaw = THREE.MathUtils.degToRad(5.0);
  const maxHoverPitch = THREE.MathUtils.degToRad(3.5);

  let tiltTargetYaw = 0;
  let tiltTargetPitch = 0;
  let tiltYaw = 0;
  let tiltPitch = 0;
  let hoverTargetYaw = 0;
  let hoverTargetPitch = 0;
  let hoverYaw = 0;
  let hoverPitch = 0;
  let distance = 17.5;
  const target = new THREE.Vector3(0, -0.35, 0.15);

  const computeDistance = (w: number, h: number): void => {
    const aspect = w / Math.max(1, h);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const tanHalfV = Math.tan(fovRad * 0.5);
    const tanHalfH = tanHalfV * aspect;

    // Fit square island + generous view of satellite islets cleanly (on narrow portrait screens,
    // frame the main board generously without slicing satellite tips at the viewport edges)
    const radiusV = 5.45;
    const radiusH = aspect < 0.85 ? 4.72 : 6.65;
    const distV = radiusV / tanHalfV;
    const distH = radiusH / tanHalfH;
    distance = Math.max(distV, distH);
    target.set(0, aspect < 0.85 ? -0.45 : -0.3, 0.18);
  };

  const update = (dt: number, reducedMotion: boolean): void => {
    const hoverEase = reducedMotion ? 1 : Math.min(1, dt * 7.5);
    const tiltEase = reducedMotion ? 1 : Math.min(1, dt * 14);
    hoverYaw += (hoverTargetYaw - hoverYaw) * hoverEase;
    hoverPitch += (hoverTargetPitch - hoverPitch) * hoverEase;
    tiltYaw += (tiltTargetYaw - tiltYaw) * tiltEase;
    tiltPitch += (tiltTargetPitch - tiltPitch) * tiltEase;

    const azim = baseAzim + tiltYaw + (reducedMotion ? 0 : hoverYaw);
    const elev = THREE.MathUtils.clamp(
      baseElev + tiltPitch + (reducedMotion ? 0 : hoverPitch),
      minElev,
      maxElev
    );

    const horiz = distance * Math.cos(elev);
    camera.position.set(
      target.x + Math.sin(azim) * horiz,
      target.y + Math.sin(elev) * distance,
      target.z + Math.cos(azim) * horiz
    );
    camera.lookAt(target);
  };

  const resize = (w: number, h: number): void => {
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    computeDistance(w, h);
  };

  const setHoverNormalized = (nx: number, ny: number): void => {
    hoverTargetYaw = nx * maxHoverYaw;
    hoverTargetPitch = ny * maxHoverPitch;
  };

  const clearHover = (): void => {
    hoverTargetYaw = 0;
    hoverTargetPitch = 0;
  };

  const applyDragDelta = (dx: number, dy: number): void => {
    // Clamped drag-to-tilt (persists at chosen angle until recentered)
    tiltTargetYaw = THREE.MathUtils.clamp(tiltTargetYaw - dx * 0.0055, minTiltYaw, maxTiltYaw);
    tiltTargetPitch = THREE.MathUtils.clamp(
      tiltTargetPitch + dy * 0.0045,
      minTiltPitch,
      maxTiltPitch
    );
  };

  const recenter = (): void => {
    tiltTargetYaw = 0;
    tiltTargetPitch = 0;
  };

  computeDistance(width, height);
  update(1, false);

  return {
    camera,
    resize,
    setHoverNormalized,
    clearHover,
    applyDragDelta,
    recenter,
    update,
  };
}
