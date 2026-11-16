import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import {
  getCorrugatedWallTexture,
  getDockSignTexture,
  getHazardStripeTexture,
  getWallSignTexture,
} from './textures';
import { useInstancedTransforms, type InstanceTransform } from './instancing';

function WallWindows({ wall }: { wall: 'north' | 'west' }) {
  const isNorth = wall === 'north';
  const positions = isNorth ? [-27, -21, -15, -9, -3] : [-12, -4, 4, 12];
  const groupPosition: [number, number, number] = isNorth
    ? [0, 0, -19.86]
    : [-31.86, 0, 0];
  const groupRotation: [number, number, number] = isNorth ? [0, 0, 0] : [0, Math.PI / 2, 0];

  return (
    <group position={groupPosition} rotation={groupRotation}>
      {positions.map((position) => (
        <group key={`${wall}-window-${position}`} position={[position, 8.35, 0]}>
          <mesh>
            <planeGeometry args={[4.5, 1.35]} />
            <meshPhysicalMaterial
              color="#91aab5"
              emissive="#58737e"
              emissiveIntensity={0.45}
              metalness={0.5}
              roughness={0.12}
              transparent
              opacity={0.62}
            />
          </mesh>
          <mesh position={[0, -0.74, 0.035]}>
            <boxGeometry args={[4.7, 0.1, 0.1]} />
            <meshStandardMaterial color="#343b40" metalness={0.6} roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.74, 0.035]}>
            <boxGeometry args={[4.7, 0.1, 0.1]} />
            <meshStandardMaterial color="#343b40" metalness={0.6} roughness={0.45} />
          </mesh>
          <mesh position={[-2.31, 0, 0.035]}>
            <boxGeometry args={[0.1, 1.55, 0.1]} />
            <meshStandardMaterial color="#343b40" metalness={0.6} roughness={0.45} />
          </mesh>
          <mesh position={[2.31, 0, 0.035]}>
            <boxGeometry args={[0.1, 1.55, 0.1]} />
            <meshStandardMaterial color="#343b40" metalness={0.6} roughness={0.45} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.055, 1.35, 0.06]} />
            <meshStandardMaterial color="#3a4247" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

interface WallPortalProps {
  position: [number, number, number];
  rotationY: number;
  label: string;
  subtitle: string;
  width?: number;
}

function WallPortal({ position, rotationY, label, subtitle, width = 3.7 }: WallPortalProps) {
  const signTexture = useMemo(() => getDockSignTexture(label, subtitle), [label, subtitle]);
  const hazardTexture = useMemo(getHazardStripeTexture, []);
  const height = 4.7;
  const halfWidth = width / 2;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, height / 2 - 0.15, 0.085]}>
        <planeGeometry args={[width - 0.3, height - 0.3]} />
        <meshStandardMaterial color="#13181c" roughness={0.95} metalness={0.05} />
      </mesh>

      <mesh position={[-halfWidth, height / 2, 0.15]}>
        <boxGeometry args={[0.2, height, 0.25]} />
        <meshStandardMaterial map={hazardTexture} roughness={0.58} metalness={0.3} />
      </mesh>
      <mesh position={[halfWidth, height / 2, 0.15]}>
        <boxGeometry args={[0.2, height, 0.25]} />
        <meshStandardMaterial map={hazardTexture} roughness={0.58} metalness={0.3} />
      </mesh>
      <mesh position={[0, height, 0.15]}>
        <boxGeometry args={[width + 0.45, 0.24, 0.3]} />
        <meshStandardMaterial map={hazardTexture} roughness={0.58} metalness={0.3} />
      </mesh>

      <mesh position={[-halfWidth, 0.95, 0.42]}>
        <boxGeometry args={[0.16, 1.9, 0.16]} />
        <meshStandardMaterial color="#272d31" roughness={0.55} metalness={0.45} />
      </mesh>
      <mesh position={[halfWidth, 0.95, 0.42]}>
        <boxGeometry args={[0.16, 1.9, 0.16]} />
        <meshStandardMaterial color="#272d31" roughness={0.55} metalness={0.45} />
      </mesh>

      <mesh position={[0, height - 0.58, 0.25]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.27, 0.27, width - 0.35, 20]} />
        <meshStandardMaterial color="#9da1a1" roughness={0.4} metalness={0.55} />
      </mesh>

      {Array.from({ length: 5 }, (_, index) => (
        <mesh key={`slat-${index}`} position={[0, height - 0.32 - index * 0.075, 0.3]}>
          <boxGeometry args={[width - 0.32, 0.055, 0.07]} />
          <meshStandardMaterial color="#7d8383" roughness={0.48} metalness={0.5} />
        </mesh>
      ))}

      <mesh position={[-halfWidth + 0.15, 0.42, 0.65]}>
        <boxGeometry args={[0.38, 0.7, 0.22]} />
        <meshStandardMaterial color="#171c20" roughness={0.9} />
      </mesh>
      <mesh position={[halfWidth - 0.15, 0.42, 0.65]}>
        <boxGeometry args={[0.38, 0.7, 0.22]} />
        <meshStandardMaterial color="#171c20" roughness={0.9} />
      </mesh>

      <mesh position={[halfWidth + 0.55, 1.35, 0.48]}>
        <boxGeometry args={[0.36, 0.55, 0.18]} />
        <meshStandardMaterial color="#454c50" roughness={0.5} metalness={0.45} />
      </mesh>
      <mesh position={[halfWidth + 0.55, 1.35, 0.58]}>
        <planeGeometry args={[0.22, 0.14]} />
        <meshStandardMaterial color="#1e3031" emissive="#406b61" emissiveIntensity={0.35} />
      </mesh>

      <mesh position={[0, 5.55, 0.18]}>
        <planeGeometry args={[3.4, 0.85]} />
        <meshStandardMaterial map={signTexture} roughness={0.52} metalness={0.22} side={THREE.DoubleSide} />
      </mesh>

      <mesh position={[0, 0.04, 1.05]}>
        <boxGeometry args={[width - 0.42, 0.08, 1.3]} />
        <meshStandardMaterial color="#4e5352" roughness={0.65} metalness={0.45} />
      </mesh>
    </group>
  );
}

function ChargingStation() {
  const { x, z } = WAREHOUSE_LAYOUT.charging;
  const hazardTexture = useMemo(getHazardStripeTexture, []);
  const signTexture = useMemo(() => getDockSignTexture('AGV CHARGING', 'BAY 01 / 02'), []);
  const chargerY = 0.82;

  const cableCurveA = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.25, 0.6, -2.45),
        new THREE.Vector3(-1.2, 0.3, -2.15),
        new THREE.Vector3(-0.85, 0.18, -1.8),
        new THREE.Vector3(-0.6, 0.32, -1.55),
      ]),
    [],
  );
  const cableCurveB = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(1.25, 0.6, -2.45),
        new THREE.Vector3(1.2, 0.3, -2.15),
        new THREE.Vector3(0.85, 0.18, -1.8),
        new THREE.Vector3(0.6, 0.32, -1.55),
      ]),
    [],
  );

  return (
    <group position={[x, 0, z]}>
      {[-1.25, 1.25].map((chargerX, index) => (
        <group position={[chargerX, 0, -2.65]} key={`charger-${index}`}>
          <mesh position={[0, chargerY, 0]} castShadow>
            <boxGeometry args={[0.9, 1.64, 0.55]} />
            <meshStandardMaterial color="#5d6467" roughness={0.55} metalness={0.38} />
          </mesh>
          <mesh position={[0, 1.67, 0]}>
            <boxGeometry args={[0.96, 0.1, 0.6]} />
            <meshStandardMaterial color="#3f4649" roughness={0.5} metalness={0.45} />
          </mesh>
          <mesh position={[0, 1.1, 0.285]}>
            <planeGeometry args={[0.56, 0.3]} />
            <meshStandardMaterial color="#a66f28" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.82, 0.29]}>
            <planeGeometry args={[0.4, 0.06]} />
            <meshBasicMaterial color="#d6bc7a" />
          </mesh>
          <mesh position={[0, 0.35, 0.29]}>
            <boxGeometry args={[0.5, 0.3, 0.06]} />
            <meshStandardMaterial color="#1c2124" roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.68, 0.13]}>
            <boxGeometry args={[0.22, 0.16, 0.2]} />
            <meshStandardMaterial color="#2b3135" roughness={0.5} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.5, 0.38]}>
            <boxGeometry args={[0.28, 0.48, 0.09]} />
            <meshStandardMaterial color="#262c2f" roughness={0.7} />
          </mesh>
        </group>
      ))}

      <mesh>
        <tubeGeometry args={[cableCurveA, 24, 0.026, 7, false]} />
        <meshStandardMaterial color="#121719" roughness={0.82} />
      </mesh>
      <mesh>
        <tubeGeometry args={[cableCurveB, 24, 0.026, 7, false]} />
        <meshStandardMaterial color="#121719" roughness={0.82} />
      </mesh>

      {[
        [-2.9, -1.0],
        [-2.9, 1.9],
        [2.9, -1.0],
        [2.9, 1.9],
      ].map(([bollardX, bollardZ], index) => (
        <mesh key={`bollard-${index}`} position={[bollardX, 0.55, bollardZ]} castShadow>
          <cylinderGeometry args={[0.09, 0.11, 1.1, 14]} />
          <meshStandardMaterial map={hazardTexture} roughness={0.55} metalness={0.3} />
        </mesh>
      ))}

      {[-2.05, 2.05].map((postX) => (
        <mesh key={`sign-post-${postX}`} position={[postX, 1.52, -2.82]} castShadow>
          <boxGeometry args={[0.08, 3.04, 0.08]} />
          <meshStandardMaterial color="#31383c" roughness={0.5} metalness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 3.0, -2.82]}>
        <boxGeometry args={[4.28, 0.1, 0.1]} />
        <meshStandardMaterial color="#31383c" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0, 2.54, -2.76]}>
        <planeGeometry args={[3.9, 0.88]} />
        <meshStandardMaterial
          map={signTexture}
          roughness={0.55}
          metalness={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export function WarehouseStructure() {
  const { width, depth, wallHeight } = WAREHOUSE_LAYOUT.dimensions;
  const northWallTexture = useMemo(() => getCorrugatedWallTexture(13), []);
  const westWallTexture = useMemo(() => getCorrugatedWallTexture(8), []);
  const wallSignTexture = useMemo(getWallSignTexture, []);

  const perimeterColumns = useMemo(() => {
    const transforms: InstanceTransform[] = [];
    for (let x = -28; x <= 28; x += 8) {
      transforms.push({ position: [x, wallHeight / 2, -19.7] });
    }
    for (let z = -16; z <= 16; z += 8) {
      transforms.push({ position: [-31.7, wallHeight / 2, z] });
    }
    for (const x of [-31.7, 31.7]) {
      for (const z of [-19.7, 19.7]) {
        transforms.push({ position: [x, wallHeight / 2, z] });
      }
    }
    return transforms;
  }, [wallHeight]);

  const columnBasePositions = useMemo(
    () =>
      perimeterColumns.map((transform) => ({
        position: [transform.position[0], 0.06, transform.position[2]] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      })),
    [perimeterColumns],
  );

  const columnRef = useRef<THREE.InstancedMesh | null>(null);
  const baseRef = useRef<THREE.InstancedMesh | null>(null);
  useInstancedTransforms(columnRef, perimeterColumns);
  useInstancedTransforms(baseRef, columnBasePositions);

  const trusses = useMemo(() => [-28, -16, -4, 8, 20, 30], []);

  return (
    <group>
      {/* Inward-facing wall planes create a natural cutaway when viewed from outside. */}
      <mesh position={[0, wallHeight / 2, -depth / 2]} receiveShadow>
        <planeGeometry args={[width, wallHeight]} />
        <meshStandardMaterial map={northWallTexture} roughness={0.64} metalness={0.38} side={THREE.FrontSide} />
      </mesh>
      <mesh position={[0, wallHeight / 2, depth / 2]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[width, wallHeight]} />
        <meshStandardMaterial map={northWallTexture} roughness={0.64} metalness={0.38} side={THREE.FrontSide} />
      </mesh>
      <mesh position={[-width / 2, wallHeight / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, wallHeight]} />
        <meshStandardMaterial map={westWallTexture} roughness={0.64} metalness={0.38} side={THREE.FrontSide} />
      </mesh>
      <mesh position={[width / 2, wallHeight / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, wallHeight]} />
        <meshStandardMaterial map={westWallTexture} roughness={0.64} metalness={0.38} side={THREE.FrontSide} />
      </mesh>

      {/* Concrete wainscot along the inside base of the walls. */}
      {[
        { position: [0, 0.55, -19.91] as [number, number, number], size: [width, 1.1, 0.05] as [number, number, number] },
        { position: [0, 0.55, 19.91] as [number, number, number], size: [width, 1.1, 0.05] as [number, number, number] },
        { position: [-31.91, 0.55, 0] as [number, number, number], size: [0.05, 1.1, depth] as [number, number, number] },
        { position: [31.91, 0.55, 0] as [number, number, number], size: [0.05, 1.1, depth] as [number, number, number] },
      ].map((trim, index) => (
        <mesh key={`wainscot-${index}`} position={trim.position}>
          <boxGeometry args={trim.size} />
          <meshStandardMaterial color="#65655f" roughness={0.92} />
        </mesh>
      ))}

      <WallWindows wall="north" />
      <WallWindows wall="west" />

      <mesh position={[16, 8.15, -19.78]}>
        <planeGeometry args={[14, 2.33]} />
        <meshStandardMaterial
          map={wallSignTexture}
          roughness={0.55}
          metalness={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      <instancedMesh ref={columnRef} args={[undefined, undefined, perimeterColumns.length]} castShadow receiveShadow>
        <boxGeometry args={[0.28, wallHeight, 0.38]} />
        <meshStandardMaterial color="#3b4246" roughness={0.46} metalness={0.66} />
      </instancedMesh>
      <instancedMesh ref={baseRef} args={[undefined, undefined, columnBasePositions.length]}>
        <boxGeometry args={[0.62, 0.12, 0.72]} />
        <meshStandardMaterial color="#292f33" roughness={0.52} metalness={0.58} />
      </instancedMesh>

      {trusses.map((x) => (
        <group key={`truss-${x}`}>
          <mesh position={[x, 9.3, 0]} castShadow>
            <boxGeometry args={[0.18, 0.32, depth - 1]} />
            <meshStandardMaterial color="#3b4246" roughness={0.46} metalness={0.66} />
          </mesh>
          <mesh position={[x, 9.84, 0]}>
            <boxGeometry args={[0.12, 0.12, depth - 1]} />
            <meshStandardMaterial color="#292f33" roughness={0.52} metalness={0.58} />
          </mesh>
          {[-16, -8, 0, 8, 16].map((z) => (
            <mesh key={`truss-drop-${x}-${z}`} position={[x, 9.56, z]}>
              <boxGeometry args={[0.08, 0.5, 0.08]} />
              <meshStandardMaterial color="#3b4246" roughness={0.46} metalness={0.66} />
            </mesh>
          ))}
        </group>
      ))}

      {[-12, 0, 12].map((z) => (
        <mesh key={`purlin-${z}`} position={[0, 9.98, z]}>
          <boxGeometry args={[width - 1, 0.12, 0.12]} />
          <meshStandardMaterial color="#292f33" roughness={0.52} metalness={0.58} />
        </mesh>
      ))}

      {[-18.6, 18.6].map((pipeZ) => (
        <group key={`sprinkler-${pipeZ}`}>
          <mesh position={[0, 8.92, pipeZ]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.075, 0.075, width - 2, 12]} />
            <meshStandardMaterial color="#97372c" roughness={0.5} metalness={0.55} />
          </mesh>
          {[-24, -12, 0, 12, 24].map((x) => (
            <mesh key={`hanger-${pipeZ}-${x}`} position={[x, 9.25, pipeZ]}>
              <cylinderGeometry args={[0.025, 0.025, 0.6, 8]} />
              <meshStandardMaterial color="#292f33" roughness={0.52} metalness={0.58} />
            </mesh>
          ))}
        </group>
      ))}

      <mesh position={[0, 8.86, -16]} castShadow>
        <boxGeometry args={[width - 4, 0.08, 0.38]} />
        <meshStandardMaterial color="#292f33" roughness={0.52} metalness={0.58} />
      </mesh>

      {WAREHOUSE_LAYOUT.docks.map((dock) => (
        <WallPortal
          key={dock.id}
          position={[dock.x, 0, 19.72]}
          rotationY={Math.PI}
          label={dock.label}
          subtitle={dock.subtitle}
        />
      ))}

      <WallPortal
        position={[31.72, 0, -5.8]}
        rotationY={-Math.PI / 2}
        label="ENTRANCE"
        subtitle="AGV INBOUND"
        width={3.2}
      />
      <WallPortal
        position={[31.72, 0, 5.8]}
        rotationY={-Math.PI / 2}
        label="EXIT"
        subtitle="AGV OUTBOUND"
        width={3.2}
      />

      <ChargingStation />
    </group>
  );
}
