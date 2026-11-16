import { Environment, Lightformer } from '@react-three/drei';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';

const FIXTURES = [
  { x: -19, z: -9.2 },
  { x: -9, z: -9.2 },
  { x: 1, z: -9.2 },
  { x: -19, z: -1.6 },
  { x: -9, z: -1.6 },
  { x: 1, z: -1.6 },
  { x: -19, z: 6 },
  { x: -9, z: 6 },
  { x: 1, z: 6 },
  { x: 12, z: 7.5 },
  { x: 22, z: 7.5 },
  { x: 12, z: 15.5 },
  { x: 25, z: -14.6 },
];

const PRACTICAL_LIGHTS: Array<{
  position: [number, number, number];
  intensity: number;
  distance: number;
}> = [
  { position: [-14, 7.9, -9.2], intensity: 55, distance: 24 },
  { position: [-14, 7.9, -1.6], intensity: 60, distance: 25 },
  { position: [-14, 7.9, 6], intensity: 55, distance: 24 },
  { position: [4, 8.1, -1.6], intensity: 45, distance: 22 },
  { position: [16, 8.1, 10], intensity: 55, distance: 26 },
  { position: [26, 7.8, -12], intensity: 40, distance: 20 },
];

function LedFixture({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 8.2, z]}>
      {[-0.9, 0.9].map((rodX) => (
        <mesh key={rodX} position={[rodX, 0.72, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.42, 6]} />
          <meshStandardMaterial color="#2b3034" metalness={0.65} roughness={0.45} />
        </mesh>
      ))}
      <mesh castShadow>
        <boxGeometry args={[2.4, 0.14, 0.34]} />
        <meshStandardMaterial color="#30363a" metalness={0.55} roughness={0.48} />
      </mesh>
      <mesh position={[0, -0.078, 0]}>
        <boxGeometry args={[2.15, 0.028, 0.22]} />
        <meshBasicMaterial color="#fff3d6" toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.095, 0]}>
        <boxGeometry args={[2.32, 0.012, 0.29]} />
        <meshStandardMaterial color="#d9d4c4" roughness={0.35} metalness={0.1} />
      </mesh>
    </group>
  );
}

export function WarehouseLighting() {
  return (
    <>
      <ambientLight intensity={0.66} color="#c5ccd1" />
      <hemisphereLight args={['#d5e1e8', '#3a3126', 0.72]} />
      <directionalLight
        position={[-28, 32, 18]}
        intensity={2.35}
        color="#fff0d8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-42}
        shadow-camera-right={42}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-near={1}
        shadow-camera-far={100}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
      />
      <directionalLight position={[24, 16, -24]} intensity={0.42} color="#bacbd9" />

      {PRACTICAL_LIGHTS.map((light, index) => (
        <pointLight
          key={`practical-${index}`}
          position={light.position}
          intensity={light.intensity}
          distance={light.distance}
          decay={2}
          color="#ffe8c4"
        />
      ))}

      {FIXTURES.map((fixture, index) => (
        <LedFixture key={`fixture-${index}`} x={fixture.x} z={fixture.z} />
      ))}

      <Environment resolution={128} frames={1}>
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#fff1d5"
          position={[0, 16, 0]}
          scale={[30, 20, 1]}
          rotation-x={Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={0.8}
          color="#c0d9e4"
          position={[-25, 8, -10]}
          scale={[18, 9, 1]}
          rotation-y={Math.PI / 2}
        />
        <Lightformer
          form="rect"
          intensity={0.5}
          color="#ffe0b5"
          position={[22, 5, 16]}
          scale={[14, 8, 1]}
          rotation-y={-Math.PI / 2}
        />
      </Environment>

      {/* A cool floor bounce keeps the underside of the AGV readable. */}
      <pointLight
        position={[WAREHOUSE_LAYOUT.agv.spawn[0], 1.1, WAREHOUSE_LAYOUT.agv.spawn[2]]}
        intensity={8}
        distance={8}
        decay={2}
        color="#b9d1e2"
      />
    </>
  );
}
