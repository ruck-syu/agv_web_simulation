import { useLayoutEffect, type RefObject } from 'react';
import * as THREE from 'three';

export interface InstanceTransform {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

export function useInstancedTransforms(
  meshRef: RefObject<THREE.InstancedMesh | null>,
  transforms: InstanceTransform[],
): void {
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    transforms.forEach((transform, index) => {
      dummy.position.set(...transform.position);
      dummy.rotation.set(...(transform.rotation ?? [0, 0, 0]));
      dummy.scale.set(...(transform.scale ?? [1, 1, 1]));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [meshRef, transforms]);
}
