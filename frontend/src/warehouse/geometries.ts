import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let palletGeometry: THREE.BufferGeometry | null = null;
let cartonGeometry: THREE.BufferGeometry | null = null;

/**
 * Builds one merged geometry for a standard 1200 x 850 mm wooden pallet so
 * every pallet in the warehouse can be rendered through a single instanced
 * draw call per rack row.
 */
export function getPalletGeometry(): THREE.BufferGeometry {
  if (palletGeometry) return palletGeometry;

  const parts: THREE.BufferGeometry[] = [];

  const addBoard = (
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(x, y, z);
    parts.push(geometry);
  };

  for (const z of [-0.36, -0.18, 0, 0.18, 0.36]) {
    addBoard(1.2, 0.025, 0.14, 0, 0.0675, z);
  }

  for (const z of [-0.34, 0, 0.34]) {
    addBoard(1.2, 0.022, 0.13, 0, -0.0675, z);
  }

  for (const x of [-0.52, 0, 0.52]) {
    addBoard(0.13, 0.11, 0.85, x, 0, 0);
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error('Unable to create pallet geometry.');
  merged.computeVertexNormals();
  palletGeometry = merged;
  return palletGeometry;
}

export function getCartonGeometry(): THREE.BufferGeometry {
  if (cartonGeometry) return cartonGeometry;
  cartonGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.035);
  return cartonGeometry;
}
