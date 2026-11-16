import { useMemo } from 'react';
import * as THREE from 'three';
import { getCartonGeometry, getPalletGeometry } from './geometries';
import { getCardboardTexture, getWoodTexture } from './textures';

interface CartonPiece {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotationY: number;
  variant: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCartons(seed: number): CartonPiece[] {
  const random = mulberry32(seed);
  const pieces: CartonPiece[] = [];
  for (let index = 0; index < 5; index += 1) {
    const width = 0.3 + random() * 0.22;
    const depth = 0.26 + random() * 0.16;
    const height = 0.24 + random() * 0.18;
    const x = -0.28 + (index % 3) * 0.29 + (random() - 0.5) * 0.03;
    const z = index < 3 ? -0.17 : 0.16;
    const y = 0.08 + height / 2;
    pieces.push({
      x,
      y,
      z: z + (random() - 0.5) * 0.025,
      width,
      height,
      depth,
      rotationY: (random() - 0.5) * 0.06,
      variant: Math.floor(random() * 3),
    });
  }
  for (let index = 0; index < 2; index += 1) {
    const width = 0.28 + random() * 0.2;
    const height = 0.2 + random() * 0.12;
    const depth = 0.24 + random() * 0.12;
    pieces.push({
      x: -0.16 + index * 0.34,
      y: 0.08 + 0.32 + height / 2,
      z: -0.04 + (random() - 0.5) * 0.08,
      width,
      height,
      depth,
      rotationY: (random() - 0.5) * 0.08,
      variant: Math.floor(random() * 3),
    });
  }
  return pieces;
}

function PalletLoad({
  x,
  z,
  rotationY,
  seed,
  wrapped = false,
}: {
  x: number;
  z: number;
  rotationY: number;
  seed: number;
  wrapped?: boolean;
}) {
  const palletGeometry = useMemo(getPalletGeometry, []);
  const cartonGeometry = useMemo(getCartonGeometry, []);
  const woodTexture = useMemo(getWoodTexture, []);
  const cardboardTexture = useMemo(getCardboardTexture, []);
  const cartons = useMemo(() => buildCartons(seed), [seed]);

  const cartonMaterials = useMemo(
    () =>
      ['#ffffff', '#f1e2cd', '#ddc7a8'].map(
        (color) =>
          new THREE.MeshStandardMaterial({
            map: cardboardTexture,
            color,
            roughness: 0.9,
            metalness: 0.01,
          }),
      ),
    [cardboardTexture],
  );

  return (
    <group position={[x, 0, z]} rotation={[0, rotationY, 0]}>
      <mesh geometry={palletGeometry} castShadow receiveShadow>
        <meshStandardMaterial map={woodTexture} roughness={0.82} />
      </mesh>

      {cartons.map((carton, index) => (
        <mesh
          key={`carton-${index}`}
          geometry={cartonGeometry}
          material={cartonMaterials[carton.variant]}
          position={[carton.x, carton.y, carton.z]}
          rotation={[0, carton.rotationY, 0]}
          scale={[carton.width, carton.height, carton.depth]}
          castShadow
          receiveShadow
        />
      ))}

      {wrapped && (
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[1.12, 0.84, 0.82]} />
          <meshPhysicalMaterial
            color="#eef1ed"
            transparent
            opacity={0.2}
            roughness={0.15}
            metalness={0}
            clearcoat={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

function EmptyPalletStack({ x, z, count }: { x: number; z: number; count: number }) {
  const palletGeometry = useMemo(getPalletGeometry, []);
  const woodTexture = useMemo(getWoodTexture, []);
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: count }, (_, index) => (
        <mesh
          key={index}
          geometry={palletGeometry}
          position={[0, 0.08 + index * 0.17, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial map={woodTexture} roughness={0.82} />
        </mesh>
      ))}
    </group>
  );
}

function TrafficCone({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.035, 0]} receiveShadow>
        <boxGeometry args={[0.28, 0.07, 0.28]} />
        <meshStandardMaterial color="#332a1d" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.27, 0]} castShadow>
        <coneGeometry args={[0.12, 0.44, 16]} />
        <meshStandardMaterial color="#cf6a22" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.29, 0]}>
        <cylinderGeometry args={[0.077, 0.097, 0.08, 16]} />
        <meshStandardMaterial color="#e2dbca" roughness={0.7} />
      </mesh>
    </group>
  );
}

function Drum({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.43, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.82, 20]} />
        <meshStandardMaterial color={color} roughness={0.58} metalness={0.4} />
      </mesh>
      {[0.15, 0.43, 0.71].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.285, 0.018, 6, 24]} />
          <meshStandardMaterial color="#272c2f" roughness={0.5} metalness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

export function StagingArea() {
  return (
    <group>
      <PalletLoad x={10.1} z={17.6} rotationY={0.02} seed={11} wrapped />
      <PalletLoad x={19.6} z={17.7} rotationY={-0.03} seed={27} />
      <PalletLoad x={27.2} z={17.5} rotationY={0.04} seed={31} wrapped />
      <PalletLoad x={8.9} z={11.8} rotationY={0.01} seed={44} />
      <PalletLoad x={11.3} z={11.6} rotationY={-0.02} seed={51} />

      <EmptyPalletStack x={9.1} z={8.1} count={5} />
      <EmptyPalletStack x={9.2} z={6.6} count={3} />
      <EmptyPalletStack x={29.4} z={12.3} count={4} />

      <TrafficCone x={7.8} z={15.2} />
      <TrafficCone x={7.9} z={18.4} />
      <TrafficCone x={29.7} z={8.3} />
      <TrafficCone x={29.8} z={-9.1} />

      <Drum x={29.6} z={-1.4} color="#335870" />
      <Drum x={29.6} z={-0.7} color="#335870" />
      <Drum x={28.1} z={-8.7} color="#5d5f54" />
    </group>
  );
}
