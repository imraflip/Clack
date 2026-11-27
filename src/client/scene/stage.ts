import * as THREE from 'three';
import type { BiomePalette } from '../../shared/levels';

export type QualityTier = 'high' | 'medium' | 'low';

export type StageCallbacks = {
  readonly onContextLost?: () => void;
  readonly onContextRestored?: () => void;
};

export type StageController = {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly rimLight: THREE.DirectionalLight;
  readonly underFillLight: THREE.DirectionalLight;
  readonly getQualityTier: () => QualityTier;
  readonly isContextLost: () => boolean;
  readonly applyBiomePalette: (palette: BiomePalette) => void;
  readonly recordFrameMs: (frameMs: number) => void;
  readonly resize: (width: number, height: number) => void;
  readonly dispose: () => void;
};

const SKY_VERTEX_SHADER = `
  varying vec3 vWorldDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SKY_FRAGMENT_SHADER = `
  uniform vec3 uSkyCenter;
  uniform vec3 uSkyEdge;
  varying vec3 vWorldDir;
  void main() {
    float h = clamp(vWorldDir.y * 0.65 + 0.38, 0.0, 1.0);
    float radial = smoothstep(0.0, 1.0, pow(abs(h - 0.35) * 1.45, 0.9));
    vec3 col = mix(uSkyCenter, uSkyEdge, clamp(radial, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createStage(
  container: HTMLElement,
  callbacks?: StageCallbacks
): StageController {
  const scene = new THREE.Scene();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });

  let currentTier: QualityTier = 'high';
  let contextLost = false;
  let lastPalette: BiomePalette | null = null;

  const applyTierSettings = (tier: QualityTier, sun: THREE.DirectionalLight): void => {
    currentTier = tier;
    const dpr = window.devicePixelRatio || 1;
    if (tier === 'high') {
      renderer.setPixelRatio(Math.min(dpr, 2));
      sun.shadow.mapSize.set(2048, 2048);
    } else if (tier === 'medium') {
      renderer.setPixelRatio(Math.min(dpr, 1.5));
      sun.shadow.mapSize.set(1024, 1024);
    } else {
      renderer.setPixelRatio(1);
      sun.shadow.mapSize.set(512, 512);
    }
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  };

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Pastel sky gradient dome
  const skyUniforms = {
    uSkyCenter: { value: new THREE.Color('#fff9f0') },
    uSkyEdge: { value: new THREE.Color('#dce2f5') },
  };
  const skyGeo = new THREE.SphereGeometry(68, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -10;
  scene.add(skyDome);

  // Lighting rig (updated cleanly per biome palette)
  const sunLight = new THREE.DirectionalLight(0xfff3de, 2.05);
  sunLight.position.set(7.5, 13.5, 6.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 32;
  sunLight.shadow.camera.left = -7.2;
  sunLight.shadow.camera.right = 7.2;
  sunLight.shadow.camera.top = 7.2;
  sunLight.shadow.camera.bottom = -7.2;
  sunLight.shadow.bias = -0.00045;
  sunLight.shadow.normalBias = 0.028;
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0xdde7ff, 0xa6896b, 1.05);
  scene.add(hemiLight);

  // Subtle cool-warm rim light to make metallic brass pop
  const rimLight = new THREE.DirectionalLight(0xfff5e6, 0.55);
  rimLight.position.set(-8, 6, -9);
  scene.add(rimLight);

  // Soft pastel upward fill catching the chiseled rock facets beneath the island
  const underFillLight = new THREE.DirectionalLight(0xdde7ff, 0.56);
  underFillLight.position.set(-5.5, -7.5, 7.0);
  scene.add(underFillLight);

  // Automatic quality tier selection from initial frame timing
  const WARMUP_FRAMES = 8;
  const SAMPLE_FRAMES = 32;
  let frameCounter = 0;
  let sampleSumMs = 0;
  let sampleCount = 0;
  let tierLocked = false;

  const recordFrameMs = (frameMs: number): void => {
    if (tierLocked) return;
    if (frameMs <= 0 || frameMs > 250) return; // Ignore background tab spikes
    frameCounter += 1;
    if (frameCounter <= WARMUP_FRAMES) return;

    sampleSumMs += frameMs;
    sampleCount += 1;
    if (sampleCount >= SAMPLE_FRAMES) {
      const avgMs = sampleSumMs / sampleCount;
      tierLocked = true;
      if (avgMs > 34) {
        applyTierSettings('low', sunLight);
      } else if (avgMs > 22) {
        applyTierSettings('medium', sunLight);
      }
    }
  };

  const applyBiomePalette = (palette: BiomePalette): void => {
    lastPalette = palette;
    document.documentElement.style.setProperty('--sky-center', palette.skyCenter);
    document.documentElement.style.setProperty('--sky-edge', palette.skyEdge);

    skyUniforms.uSkyCenter.value.set(palette.skyCenter);
    skyUniforms.uSkyEdge.value.set(palette.skyEdge);

    sunLight.color.setHex(palette.sunColor);
    sunLight.intensity = palette.sunIntensity;
    hemiLight.color.setHex(palette.hemiSky);
    // Gently lift ground bounce toward pastel sky edge so underside stone facets stay readable
    const groundCol = new THREE.Color(palette.hemiGround).lerp(
      new THREE.Color(palette.skyEdge),
      0.26
    );
    hemiLight.groundColor.copy(groundCol);
    hemiLight.intensity = palette.hemiIntensity + 0.08;

    const bounceCol = new THREE.Color(palette.skyEdge).lerp(
      new THREE.Color(palette.hemiSky),
      0.4
    );
    underFillLight.color.copy(bounceCol);
    underFillLight.intensity = 0.56;
  };

  const resize = (width: number, height: number): void => {
    renderer.setSize(Math.max(1, width), Math.max(1, height));
  };

  const onWebGLContextLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
    callbacks?.onContextLost?.();
  };

  const onWebGLContextRestored = (): void => {
    contextLost = false;
    applyTierSettings(currentTier, sunLight);
    if (lastPalette) {
      applyBiomePalette(lastPalette);
    }
    renderer.shadowMap.needsUpdate = true;
    callbacks?.onContextRestored?.();
  };

  renderer.domElement.addEventListener('webglcontextlost', onWebGLContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onWebGLContextRestored);

  const dispose = (): void => {
    renderer.domElement.removeEventListener('webglcontextlost', onWebGLContextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', onWebGLContextRestored);
    skyGeo.dispose();
    skyMat.dispose();
    sunLight.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
  };

  return {
    scene,
    renderer,
    sunLight,
    hemiLight,
    rimLight,
    underFillLight,
    getQualityTier: () => currentTier,
    isContextLost: () => contextLost,
    applyBiomePalette,
    recordFrameMs,
    resize,
    dispose,
  };
}
