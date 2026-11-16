import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RackRowConfig } from '../config/warehouseConfig';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import { getHazardStripeTexture, getRackSignTexture } from '../warehouse/textures';
import { RackContents } from './RackContents';
import { generateRackInventory } from './rackInventory';
import { useInstancedTransforms, type InstanceTransform } from './instancing';

function buildStructureTransforms(row: RackRowConfig) {
  const rack = WAREHOUSE_LAYOUT.rack;
  const halfLength = rack.length / 2;
  const halfDepth = rack.depth / 2;
  const columnZ = halfDepth - 0.07;
  const columns: InstanceTransform[] = [];
  const footplates: InstanceTransform[] = [];
  const beams: InstanceTransform[] = [];
  const deckBars: InstanceTransform[] = [];
  const braces: InstanceTransform[] = [];

  for (let bay = 0; bay <= rack.bays; bay += 1) {
    const x = -halfLength + bay * rack.bayWidth;
    for (const z of [-columnZ, columnZ]) {
      columns.push({ position: [x, rack.height / 2, z] });
      footplates.push({ position: [x, 0.015, z] });
    }
  }

  rack.beamLevels.forEach((level) => {
    for (let bay = 0; bay < rack.bays; bay += 1) {
      const x = -halfLength + rack.bayWidth * (bay + 0.5);
      for (const z of [-columnZ, columnZ]) {
        beams.push({ position: [x, level, z] });
      }
      for (const offset of [-0.72, -0.36, 0, 0.36, 0.72]) {
        deckBars.push({ position: [x + offset, level + 0.048, 0] });
      }
    }
  });

  for (const x of [-halfLength, halfLength]) {
    for (const centerY of [1.25, 3.95]) {
      for (const direction of [-1, 1]) {
        braces.push({
          position: [x, centerY, 0],
          rotation: [direction * 0.43, 0, 0],
          scale: [1, 2.53, 1],
        });
      }
    }
  }

  const guardZ = row.face * (halfDepth + 0.32);
  const guards: InstanceTransform[] = [
    { position: [-(halfLength + 0.2), 0.58, guardZ] },
    { position: [halfLength + 0.2, 0.58, guardZ] },
  ];

  return { columns, footplates, beams, deckBars, braces, guards };
}

export function RackRow({ row }: { row: RackRowConfig }) {
  const rack = WAREHOUSE_LAYOUT.rack;
  const structure = useMemo(() => buildStructureTransforms(row), [row]);
  const inventory = useMemo(() => generateRackInventory(row), [row]);
  const hazardTexture = useMemo(getHazardStripeTexture, []);
  const signTexture = useMemo(
    () => getRackSignTexture(row.label, `${row.aisleSide.toUpperCase()} · 4 LEVELS`),
    [row.aisleSide, row.label],
  );

  const columnRef = useRef<THREE.InstancedMesh | null>(null);
  const footplateRef = useRef<THREE.InstancedMesh | null>(null);
  const beamRef = useRef<THREE.InstancedMesh | null>(null);
  const deckRef = useRef<THREE.InstancedMesh | null>(null);
  const braceRef = useRef<THREE.InstancedMesh | null>(null);
  const guardRef = useRef<THREE.InstancedMesh | null>(null);

  useInstancedTransforms(columnRef, structure.columns);
  useInstancedTransforms(footplateRef, structure.footplates);
  useInstancedTransforms(beamRef, structure.beams);
  useInstancedTransforms(deckRef, structure.deckBars);
  useInstancedTransforms(braceRef, structure.braces);
  useInstancedTransforms(guardRef, structure.guards);

  const signX = -rack.length / 2 + 2.2;
  const signZ = row.face * (rack.depth / 2 + 0.045);

  return (
    <group position={[row.x, 0, row.z]}>
      <instancedMesh
        ref={columnRef}
        args={[undefined, undefined, structure.columns.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[rack.upright, rack.height, rack.upright]} />
        <meshStandardMaterial color={rack.colors.upright} roughness={0.45} metalness={0.7} />
      </instancedMesh>

      <instancedMesh
        ref={footplateRef}
        args={[undefined, undefined, structure.footplates.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.34, 0.03, 0.34]} />
        <meshStandardMaterial color={rack.colors.footplate} roughness={0.55} metalness={0.78} />
      </instancedMesh>

      <instancedMesh
        ref={beamRef}
        args={[undefined, undefined, structure.beams.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[rack.bayWidth - 0.18, rack.beamHeight, rack.beamDepth]} />
        <meshStandardMaterial color={rack.colors.beam} roughness={0.4} metalness={0.62} />
      </instancedMesh>

      <instancedMesh
        ref={deckRef}
        args={[undefined, undefined, structure.deckBars.length]}
        receiveShadow
      >
        <boxGeometry args={[0.045, 0.03, rack.depth - 0.16]} />
        <meshStandardMaterial color={rack.colors.deck} roughness={0.58} metalness={0.62} />
      </instancedMesh>

      <instancedMesh
        ref={braceRef}
        args={[undefined, undefined, structure.braces.length]}
        castShadow
      >
        <boxGeometry args={[0.045, 1, 0.045]} />
        <meshStandardMaterial color={rack.colors.uprightDark} roughness={0.48} metalness={0.62} />
      </instancedMesh>

      <instancedMesh
        ref={guardRef}
        args={[undefined, undefined, structure.guards.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.16, 1.16, 0.16]} />
        <meshStandardMaterial map={hazardTexture} roughness={0.6} metalness={0.25} />
      </instancedMesh>

      <RackContents inventory={inventory} />

      <mesh
        position={[signX, 6.12, signZ]}
        rotation={[0, row.face === 1 ? 0 : Math.PI, 0]}
        castShadow={false}
      >
        <planeGeometry args={[2.7, 0.675]} />
        <meshStandardMaterial
          map={signTexture}
          roughness={0.55}
          metalness={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
