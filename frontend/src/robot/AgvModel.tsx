import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { ContactShadows, RoundedBox } from '@react-three/drei';
import type * as THREE from 'three';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import { useSimulation } from '../simulation/SimulationProvider';
import { getAgvDecalTexture, getHazardStripeTexture } from '../warehouse/textures';

const COLORS = {
  body: '#c87522',
  bodyDark: '#984f13',
  chassis: '#252a2e',
  bumper: '#15191c',
  metal: '#6d757b',
  rubber: '#151718',
  accent: '#e3a94e',
};

function DriveWheel({
  z,
  innerRef,
}: {
  z: number;
  innerRef: RefObject<THREE.Group>;
}) {
  return (
    <group ref={innerRef} position={[0, 0.19, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.19, 0.19, 0.12, 28]} />
        <meshStandardMaterial color={COLORS.rubber} roughness={0.92} metalness={0.04} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.094, 0.094, 0.13, 22]} />
        <meshStandardMaterial color={COLORS.metal} roughness={0.36} metalness={0.74} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.036, 0.036, 0.145, 14]} />
        <meshStandardMaterial color="#30363a" roughness={0.42} metalness={0.62} />
      </mesh>
      {[-0.064, 0.064].map((markerZ) => (
        <mesh key={`wheel-marker-${markerZ}`} position={[0, 0.14, markerZ]}>
          <boxGeometry args={[0.05, 0.085, 0.012]} />
          <meshStandardMaterial color={COLORS.accent} roughness={0.38} metalness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function CasterWheel({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.19, 0]}>
        <boxGeometry args={[0.15, 0.15, 0.15]} />
        <meshStandardMaterial color={COLORS.chassis} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.076, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.074, 0.074, 0.064, 18]} />
        <meshStandardMaterial color={COLORS.rubber} roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.135, 0]}>
        <boxGeometry args={[0.055, 0.11, 0.028]} />
        <meshStandardMaterial color={COLORS.metal} roughness={0.45} metalness={0.6} />
      </mesh>
    </group>
  );
}

function LidarUnit() {
  return (
    <group position={[0.45, 0.69, 0]}>
      <mesh>
        <cylinderGeometry args={[0.105, 0.125, 0.06, 24]} />
        <meshStandardMaterial color="#262b2f" roughness={0.44} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.075, 0]}>
        <cylinderGeometry args={[0.07, 0.078, 0.09, 24]} />
        <meshStandardMaterial color="#1c2124" roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.145, 0]} castShadow>
        <cylinderGeometry args={[0.088, 0.092, 0.085, 28]} />
        <meshStandardMaterial color="#0e1215" roughness={0.28} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.145, 0]}>
        <torusGeometry args={[0.092, 0.01, 8, 28]} />
        <meshStandardMaterial
          color="#6ea9bd"
          emissive="#356575"
          emissiveIntensity={0.18}
          roughness={0.25}
        />
      </mesh>
      <mesh position={[0, 0.145, 0.089]}>
        <boxGeometry args={[0.12, 0.03, 0.012]} />
        <meshStandardMaterial
          color="#bcd6df"
          emissive="#577d8b"
          emissiveIntensity={0.2}
          roughness={0.15}
        />
      </mesh>
    </group>
  );
}

export function AgvModel() {
  const { spawn, heading, wheelPositions } = WAREHOUSE_LAYOUT.agv;
  const { getLatestTelemetry } = useSimulation();
  const decalTexture = useMemo(getAgvDecalTexture, []);
  const hazardTexture = useMemo(getHazardStripeTexture, []);
  const groupRef = useRef<THREE.Group>(null);
  const leftWheelRef = useRef<THREE.Group>(null);
  const rightWheelRef = useRef<THREE.Group>(null);
  const rendered = useRef<{ x: number; z: number; yaw: number }>({
    x: spawn[0],
    z: spawn[2],
    yaw: heading,
  });

  useFrame((_, delta) => {
    const telemetry = getLatestTelemetry();
    const target = telemetry
      ? {
          x: telemetry.pose.x,
          z: -telemetry.pose.y,
          yaw: telemetry.pose.yaw,
        }
      : rendered.current;

    const dx = target.x - rendered.current.x;
    const dz = target.z - rendered.current.z;
    if (Math.hypot(dx, dz) > 5) {
      rendered.current.x = target.x;
      rendered.current.z = target.z;
      rendered.current.yaw = target.yaw;
    } else {
      const blend = 1 - Math.exp(-14 * Math.min(delta, 0.1));
      rendered.current.x += dx * blend;
      rendered.current.z += dz * blend;
      const yawDelta = Math.atan2(
        Math.sin(target.yaw - rendered.current.yaw),
        Math.cos(target.yaw - rendered.current.yaw),
      );
      rendered.current.yaw += yawDelta * blend;
    }

    if (groupRef.current) {
      groupRef.current.position.set(rendered.current.x, 0, rendered.current.z);
      groupRef.current.rotation.y = rendered.current.yaw;
    }
    if (leftWheelRef.current) {
      leftWheelRef.current.rotation.z = -(telemetry?.leftWheelAngle ?? 0);
    }
    if (rightWheelRef.current) {
      rightWheelRef.current.rotation.z = -(telemetry?.rightWheelAngle ?? 0);
    }
  });

  return (
    <group ref={groupRef} position={spawn} rotation={[0, heading, 0]}>
      <ContactShadows
        position={[0, 0.006, 0]}
        scale={3.4}
        opacity={0.46}
        blur={2.6}
        far={0.42}
        resolution={256}
        color="#0d0f10"
        frames={1}
      />

      <CasterWheel x={0.57} />
      <CasterWheel x={-0.57} />
      <DriveWheel z={wheelPositions.leftZ} innerRef={leftWheelRef} />
      <DriveWheel z={wheelPositions.rightZ} innerRef={rightWheelRef} />

      <RoundedBox
        args={[1.46, 0.24, 0.82]}
        radius={0.06}
        smoothness={4}
        position={[0, 0.3, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={COLORS.chassis} roughness={0.48} metalness={0.56} />
      </RoundedBox>

      <RoundedBox
        args={[1.3, 0.32, 0.72]}
        radius={0.09}
        smoothness={4}
        position={[0, 0.49, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={COLORS.body} roughness={0.42} metalness={0.28} />
      </RoundedBox>

      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[1.34, 0.025, 0.744]} />
        <meshStandardMaterial color={COLORS.bodyDark} roughness={0.5} metalness={0.25} />
      </mesh>

      <RoundedBox
        args={[1.16, 0.06, 0.66]}
        radius={0.022}
        smoothness={3}
        position={[-0.02, 0.68, 0]}
        castShadow
      >
        <meshStandardMaterial color={COLORS.chassis} roughness={0.55} metalness={0.45} />
      </RoundedBox>
      <RoundedBox args={[0.62, 0.018, 0.42]} radius={0.012} smoothness={2} position={[-0.04, 0.712, 0]}>
        <meshStandardMaterial color="#343b3f" roughness={0.62} metalness={0.32} />
      </RoundedBox>

      {[
        [-0.27, 0.22],
        [0.16, 0.22],
        [-0.27, -0.22],
        [0.16, -0.22],
      ].map(([x, z], index) => (
        <mesh key={`panel-bolt-${index}`} position={[x - 0.04, 0.723, z]}>
          <cylinderGeometry args={[0.012, 0.012, 0.008, 8]} />
          <meshStandardMaterial color="#9fa7ab" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}

      <mesh position={[0.72, 0.3, 0]} castShadow>
        <boxGeometry args={[0.1, 0.19, 0.82]} />
        <meshStandardMaterial color={COLORS.bumper} roughness={0.93} />
      </mesh>
      <mesh position={[-0.72, 0.3, 0]} castShadow>
        <boxGeometry args={[0.1, 0.19, 0.82]} />
        <meshStandardMaterial color={COLORS.bumper} roughness={0.93} />
      </mesh>

      <mesh position={[0.775, 0.3, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.58, 0.11]} />
        <meshStandardMaterial map={hazardTexture} roughness={0.72} />
      </mesh>
      <mesh position={[-0.775, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.58, 0.11]} />
        <meshStandardMaterial map={hazardTexture} roughness={0.72} />
      </mesh>

      <mesh position={[0, 0.55, 0.363]}>
        <planeGeometry args={[0.62, 0.16]} />
        <meshStandardMaterial map={decalTexture} transparent roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.55, -0.363]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.62, 0.16]} />
        <meshStandardMaterial map={decalTexture} transparent roughness={0.7} />
      </mesh>

      {[-0.42, -0.31, -0.2].map((x) => (
        <mesh key={`vent-side-${x}`} position={[x, 0.53, 0.364]}>
          <boxGeometry args={[0.04, 0.09, 0.012]} />
          <meshStandardMaterial color={COLORS.bumper} roughness={0.74} metalness={0.3} />
        </mesh>
      ))}
      {[-0.42, -0.31, -0.2].map((x) => (
        <mesh key={`vent-side-r-${x}`} position={[x, 0.53, -0.364]}>
          <boxGeometry args={[0.04, 0.09, 0.012]} />
          <meshStandardMaterial color={COLORS.bumper} roughness={0.74} metalness={0.3} />
        </mesh>
      ))}

      <mesh position={[0, 0.595, 0.364]}>
        <boxGeometry args={[0.98, 0.012, 0.006]} />
        <meshStandardMaterial color={COLORS.accent} metalness={0.38} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.595, -0.364]}>
        <boxGeometry args={[0.98, 0.012, 0.006]} />
        <meshStandardMaterial color={COLORS.accent} metalness={0.38} roughness={0.35} />
      </mesh>

      <LidarUnit />

      <group position={[-0.35, 0.715, 0.2]}>
        <mesh>
          <cylinderGeometry args={[0.064, 0.064, 0.028, 18]} />
          <meshStandardMaterial color="#1b2024" roughness={0.45} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.028, 0]}>
          <cylinderGeometry args={[0.052, 0.052, 0.042, 18]} />
          <meshStandardMaterial color="#b6372e" roughness={0.45} metalness={0.2} />
        </mesh>
      </group>

      <group position={[-0.51, 0.735, -0.16]}>
        <mesh>
          <cylinderGeometry args={[0.04, 0.05, 0.08, 16]} />
          <meshStandardMaterial color="#2b3135" roughness={0.5} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.055, 0]}>
          <sphereGeometry args={[0.043, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color="#bf7a25"
            emissive="#7c4412"
            emissiveIntensity={0.28}
            transparent
            opacity={0.82}
            roughness={0.3}
          />
        </mesh>
      </group>

      <mesh position={[-0.63, 0.58, 0]} castShadow>
        <boxGeometry args={[0.035, 0.035, 0.46]} />
        <meshStandardMaterial color={COLORS.metal} roughness={0.4} metalness={0.65} />
      </mesh>
      {[-0.22, 0.22].map((z) => (
        <mesh key={`handle-mount-${z}`} position={[-0.7, 0.58, z]}>
          <boxGeometry args={[0.1, 0.03, 0.03]} />
          <meshStandardMaterial color={COLORS.metal} roughness={0.4} metalness={0.65} />
        </mesh>
      ))}

      {[0.15, -0.15].map((z) => (
        <mesh key={`contact-${z}`} position={[-0.775, 0.38, z]}>
          <boxGeometry args={[0.015, 0.1, 0.16]} />
          <meshStandardMaterial color="#aa8748" roughness={0.3} metalness={0.85} />
        </mesh>
      ))}

      {[0.27, -0.27].map((z) => (
        <group key={`sensor-${z}`} position={[0.72, 0.41, z]}>
          <mesh>
            <boxGeometry args={[0.05, 0.075, 0.12]} />
            <meshStandardMaterial color="#111518" roughness={0.6} metalness={0.35} />
          </mesh>
          <mesh position={[0.027, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[0.07, 0.025]} />
            <meshStandardMaterial color="#7ea8b4" roughness={0.2} metalness={0.4} />
          </mesh>
        </group>
      ))}

      <mesh position={[-0.64, 0.5, 0.2]}>
        <planeGeometry args={[0.16, 0.05]} />
        <meshStandardMaterial color="#20262a" roughness={0.65} />
      </mesh>
      <mesh position={[-0.64, 0.5, 0.201]}>
        <planeGeometry args={[0.075, 0.01]} />
        <meshBasicMaterial color="#6c8a90" />
      </mesh>

      <mesh position={[0.43, 0.715, 0]} castShadow>
        <boxGeometry args={[0.14, 0.012, 0.14]} />
        <meshStandardMaterial color={COLORS.bodyDark} roughness={0.45} metalness={0.35} />
      </mesh>

      <mesh position={[0, 0.716, 0.33]}>
        <boxGeometry args={[0.5, 0.005, 0.006]} />
        <meshStandardMaterial color="#2a3034" />
      </mesh>
    </group>
  );
}
