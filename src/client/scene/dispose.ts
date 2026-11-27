import * as THREE from 'three';

export function disposeObjectTree(
  root: THREE.Object3D,
  extraTextures: readonly THREE.Texture[] = [],
  extraMaterials: readonly THREE.Material[] = []
): void {
  const textures = new Set(extraTextures);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>(extraMaterials);

  root.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) {
      child.dispose();
    }
    if (child instanceof THREE.Mesh) {
      if (child.geometry instanceof THREE.BufferGeometry) {
        geometries.add(child.geometry);
      }
      if (Array.isArray(child.material)) {
        for (const m of child.material) {
          if (m instanceof THREE.Material) {
            materials.add(m);
          }
        }
      } else if (child.material instanceof THREE.Material) {
        materials.add(child.material);
      }
    }
  });

  for (const geo of geometries) {
    geo.dispose();
  }
  for (const mat of materials) {
    for (const value of Object.values(mat)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    mat.dispose();
  }
  for (const tex of textures) {
    tex.dispose();
  }
}
