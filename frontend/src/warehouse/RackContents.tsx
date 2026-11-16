import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getCartonGeometry, getPalletGeometry } from './geometries';
import { useInstancedTransforms, type InstanceTransform } from './instancing';
import type {
  CartonTransform,
  LabelTransform,
  PalletTransform,
  RackInventory,
  TapeTransform,
} from './rackInventory';
import {
  getCardboardTexture,
  getShippingLabelTexture,
  getWoodTexture,
} from '../warehouse/textures';

const CARDBOARD_TINTS = ['#ffffff', '#f1e2cd', '#dfc9ab'];
const TAPE_COLOR = '#b6a37a';

function cartonTransforms(items: CartonTransform[]): InstanceTransform[] {
  return items.map((item) => ({
    position: item.position,
    rotation: [0, item.rotationY, 0],
    scale: item.size,
  }));
}

function palletTransforms(items: PalletTransform[]): InstanceTransform[] {
  return items.map((item) => ({
    position: item.position,
    rotation: [0, item.rotationY, 0],
  }));
}

function tapeTransforms(items: TapeTransform[]): InstanceTransform[] {
  return items.map((item) => ({
    position: item.position,
    rotation: [0, item.rotationY, 0],
    scale: item.size,
  }));
}

function labelTransforms(items: LabelTransform[]): InstanceTransform[] {
  return items.map((item) => ({
    position: item.position,
    rotation: [0, item.rotationY, 0],
    scale: [item.size[0], item.size[1], 1],
  }));
}

export function RackContents({ inventory }: { inventory: RackInventory }) {
  const cartonGeometry = useMemo(getCartonGeometry, []);
  const palletGeometry = useMemo(getPalletGeometry, []);
  const tapeGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const cardboardTexture = useMemo(getCardboardTexture, []);
  const woodTexture = useMemo(getWoodTexture, []);

  const palletRef = useRef<THREE.InstancedMesh | null>(null);
  const tapeRef = useRef<THREE.InstancedMesh | null>(null);
  const cartonRefs = [
    useRef<THREE.InstancedMesh | null>(null),
    useRef<THREE.InstancedMesh | null>(null),
    useRef<THREE.InstancedMesh | null>(null),
  ];
  const labelRefs = [
    useRef<THREE.InstancedMesh | null>(null),
    useRef<THREE.InstancedMesh | null>(null),
    useRef<THREE.InstancedMesh | null>(null),
  ];

  const palletInstances = useMemo(() => palletTransforms(inventory.pallets), [inventory.pallets]);
  const tapeInstances = useMemo(() => tapeTransforms(inventory.tapes), [inventory.tapes]);
  const cartonInstances = useMemo(
    () => inventory.cartonsByVariant.map(cartonTransforms),
    [inventory.cartonsByVariant],
  );
  const labelInstances = useMemo(
    () => inventory.labelsByVariant.map(labelTransforms),
    [inventory.labelsByVariant],
  );

  useInstancedTransforms(palletRef, palletInstances);
  useInstancedTransforms(tapeRef, tapeInstances);
  useInstancedTransforms(cartonRefs[0], cartonInstances[0]);
  useInstancedTransforms(cartonRefs[1], cartonInstances[1]);
  useInstancedTransforms(cartonRefs[2], cartonInstances[2]);
  useInstancedTransforms(labelRefs[0], labelInstances[0]);
  useInstancedTransforms(labelRefs[1], labelInstances[1]);
  useInstancedTransforms(labelRefs[2], labelInstances[2]);

  return (
    <group>
      {inventory.pallets.length > 0 && (
        <instancedMesh
          ref={palletRef}
          args={[palletGeometry, undefined, inventory.pallets.length]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial map={woodTexture} roughness={0.82} metalness={0.02} />
        </instancedMesh>
      )}

      {inventory.cartonsByVariant.map((items, variant) =>
        items.length > 0 ? (
          <instancedMesh
            key={`carton-${variant}`}
            ref={cartonRefs[variant]}
            args={[cartonGeometry, undefined, items.length]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              map={cardboardTexture}
              color={CARDBOARD_TINTS[variant]}
              roughness={0.9}
              metalness={0.01}
            />
          </instancedMesh>
        ) : null,
      )}

      {inventory.tapes.length > 0 && (
        <instancedMesh
          ref={tapeRef}
          args={[tapeGeometry, undefined, inventory.tapes.length]}
        >
          <meshStandardMaterial color={TAPE_COLOR} roughness={0.58} metalness={0.02} />
        </instancedMesh>
      )}

      {inventory.labelsByVariant.map((items, variant) =>
        items.length > 0 ? (
          <instancedMesh
            key={`label-${variant}`}
            ref={labelRefs[variant]}
            args={[new THREE.PlaneGeometry(1, 1), undefined, items.length]}
          >
            <meshStandardMaterial
              map={getShippingLabelTexture(variant)}
              roughness={0.78}
              metalness={0}
              side={THREE.DoubleSide}
              polygonOffset
              polygonOffsetFactor={-2}
            />
          </instancedMesh>
        ) : null,
      )}
    </group>
  );
}
